import { mkdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join, relative, isAbsolute, resolve } from 'node:path';
import { createModels } from '@earendil-works/pi-ai';
import { getAgentDir, VERSION, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { captureSettings, hash, modelsFor, parseRunId, parseStart } from './pi-context.js';
import { acquireOwnership, hasLiveOwner } from './pi-ownership.js';
import { atomicJson, readJson } from './pi-files.js';
import { PiRuntime, PiTerminalRunError, readRecords, selectRun, type PiRun } from './pi-runtime.js';
import { errorMessage, projectRoot, requirePi } from './util.js';
import { loadScript } from './loop.js';

type Active = {
  checkout: string; directory: string; owner: Awaited<ReturnType<typeof acquireOwnership>>;
  runtime: PiRuntime; id: string; driving?: Promise<void>; stopping?: Promise<PiRun>; finishing?: Promise<void>; suspending: boolean; closed: boolean;
};
/** `activity`: when the pending worker last committed, or waiting for it began; only while the run is running. */
export type PiReport = PiRun & {activity?: number};
export type PiNotice = {event: 'started' | 'resumed' | 'progress' | 'completed' | 'cleanup'; run: PiRun};

async function canonicalTarget(path: string): Promise<string> {
  try {return await realpath(path);}
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) throw error;
    return join(await canonicalTarget(dirname(path)), basename(path));
  }
}

export class PiService {
  private active: Active | undefined;
  private closing = false;
  constructor(private pi: Pick<ExtensionAPI, 'getCommands'>, private notice: (notice: PiNotice) => void,
    private stateHome = getAgentDir(), private openRuntime = PiRuntime.open) {}

  private async location(cwd: string) {
    const checkout = await projectRoot(cwd);
    const directory = await canonicalTarget(resolve(this.stateHome, 'openspec-verify-loop', hash(checkout)));
    const delta = relative(checkout, directory);
    if (!delta.startsWith('..') && !isAbsolute(delta)) throw new Error('Pi loop state directory must be outside the checkout');
    return {checkout, directory};
  }

  private async open(cwd: string, models: Awaited<ReturnType<typeof modelsFor>>) {
    if (this.closing) throw new Error('The Pi extension is shutting down');
    await this.settle();
    if (this.active) throw new Error(`This Pi session owns run ${this.active.id}; report or stop it first`);
    const location = await this.location(cwd);
    await mkdir(location.directory, {recursive: true, mode: 0o700});
    const owner = await acquireOwnership(location.directory);
    try {
      return {...location, owner, runtime: await this.openRuntime({...location, source: await loadScript(), models,
        progress: run => this.emit({event: 'progress', run})})};
    } catch (error) {
      try {await owner.release();}
      catch (cleanup) {throw new Error(`${errorMessage(error)}; opening cleanup failed: ${errorMessage(cleanup)}. Checkout remains owned.`);}
      throw error;
    }
  }

  /** The store commits a finished run before its driver releases the checkout; wait for that release. */
  private async settle(): Promise<void> {
    const active = this.active;
    if (active?.driving && (await this.report(active.id, {cwd: active.checkout})).state === 'terminal') await active.driving;
  }

  private emit(notice: PiNotice): void {
    if (this.closing) return;
    try { this.notice(notice); } catch (error) { console.error(`Pi loop ${notice.run.id} display failed: ${errorMessage(error)}`); }
  }

  async start(text: string, ctx: ExtensionContext): Promise<PiRun> {
    requirePi(VERSION);
    const args = parseStart(text);
    const {settings, models} = await captureSettings(this.pi, ctx, this.stateHome);
    const opened = await this.open(ctx.cwd, models);
    try {
      const run = await opened.runtime.create(settings, args);
      const active: Active = {...opened, id: run.id, suspending: false, closed: false};
      this.active = active;
      this.emit({event: 'started', run});
      active.runtime.start();
      active.driving = this.drive(active);
      return run;
    } catch (error) { await opened.runtime.close(false); await opened.owner.release(); throw error; }
  }

  async report(text: string, ctx: Pick<ExtensionContext, 'cwd'>): Promise<PiReport> {
    const id = parseRunId(text);
    const {directory} = await this.location(ctx.cwd);
    const {runs, committed} = await readRecords(directory);
    const run: PiReport = selectRun(runs, id, true);
    if (run.state === 'running' && !await hasLiveOwner(directory)) run.state = 'interrupted';
    if (run.state === 'running') run.activity = committed;
    const cleanup = await readJson<{id: string; reason: string}>(join(directory, 'cleanup.json'));
    if (cleanup?.id === run.id) {run.cleanup = cleanup.reason; run.result = {status: 'failed', reason: `Cleanup unconfirmed: ${cleanup.reason}`};}
    return run;
  }

  async resume(text: string, ctx: ExtensionContext): Promise<PiRun> {
    requirePi(VERSION);
    const id = parseRunId(text);
    await this.settle();
    if (this.active) throw new Error(`Run ${this.active.id} is already running or awaiting cleanup; use stop`);
    const opened = await this.open(ctx.cwd, createModels());
    try {
      const run = await opened.runtime.get(id);
      if (run.state === 'terminal') throw new Error(`Run ${run.id} is terminal and cannot be resumed`);
      opened.runtime.setModels(await modelsFor(ctx.modelRegistry, run.settings.model, run.settings.thinkingLevel));
      await opened.owner.assert();
      await opened.runtime.resume(run.id);
      const active: Active = {...opened, id: run.id, suspending: false, closed: false};
      this.active = active; this.emit({event: 'resumed', run}); active.driving = this.drive(active);
      return opened.runtime.get(run.id);
    } catch (error) { await opened.runtime.close(false); await opened.owner.release(); throw error; }
  }

  async stop(text: string, ctx: Pick<ExtensionContext, 'cwd'>): Promise<PiRun> {
    const {checkout} = await this.location(ctx.cwd);
    const requested = parseRunId(text);
    let active = this.active;
    if (active && (active.checkout !== checkout || (requested && active.id !== requested))) throw new Error('Run is not owned by this session in this checkout');
    if (!active) {
      const opened = await this.open(ctx.cwd, createModels());
      try {
        const run = await opened.runtime.get(requested);
        const cleanup = await readJson<{id: string}>(join(opened.directory, 'cleanup.json'));
        if (run.state === 'terminal' && !run.cleanup && cleanup?.id !== run.id) throw new Error(`Run ${run.id} is already terminal`);
        active = {...opened, id: run.id, suspending: false, closed: false}; this.active = active;
      } catch (error) { await opened.runtime.close(false); await opened.owner.release(); throw error; }
    }
    const owned = active;
    const retained = await readJson<{id: string}>(join(owned.directory, 'cleanup.json'));
    if (!retained && (owned.closed || (await owned.runtime.get(owned.id)).state === 'terminal')) {
      if (owned.finishing) await owned.finishing;
      throw new PiTerminalRunError(`Run ${owned.id} is already terminal`);
    }
    return owned.stopping ??= (async () => {
      try {
        await owned.owner.assert();
        if (owned.closed) {
          await owned.runtime.close(false);
          owned.runtime = await this.openRuntime({directory: owned.directory, checkout: owned.checkout, source: await loadScript(), models: createModels()});
          owned.closed = false;
        }
        const run = await owned.runtime.stop(owned.id, retained?.id === owned.id);
        await this.finish(owned);
        if (owned.driving) await owned.driving;
        return run;
      } catch (error) {
        if (error instanceof PiTerminalRunError) {
          try {
            if (owned.driving) await owned.driving;
            await this.finish(owned);
          }
          catch (cleanup) {await this.retain(owned, cleanup); throw cleanup;}
          throw error;
        }
        await this.retain(owned, error);
        throw error;
      } finally { owned.stopping = undefined; }
    })();
  }

  private async retain(active: Active, error: unknown) {
    const reason = errorMessage(error);
    await atomicJson(join(active.directory, 'cleanup.json'), {id: active.id, reason});
    if (!active.closed) {
      try { await active.runtime.retainFailure(active.id, error); } catch { /* The independent receipt survives a failed/closed store. */ }
    }
  }

  private finish(active: Active): Promise<void> {
    return active.finishing ??= (async () => {
      active.closed = true; await active.runtime.close(false);
      await rm(join(active.directory, 'cleanup.json'), {force: true});
      await active.owner.release();
      if (this.active === active) this.active = undefined;
    })().catch(error => {active.finishing = undefined; throw error;});
  }

  private async drive(active: Active) {
    try {
      const run = await active.runtime.wait(active.id);
      if (active.suspending || this.closing || active.stopping) return;
      await this.finish(active);
      this.emit({event: 'completed', run});
    } catch (error) {
      if (active.suspending || this.closing || active.stopping) return;
      try {
        await this.retain(active, error);
        const run = await this.report(active.id, {cwd: active.checkout});
        this.emit({event: 'cleanup', run});
      } catch (recording) {
        console.error(`Pi loop ${active.id} failed: ${errorMessage(error)}; recording failed: ${errorMessage(recording)}. Checkout remains owned.`);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    const active = this.active;
    if (!active) return;
    active.suspending = true;
    try {
      active.closed = true; await active.runtime.close();
      if (active.driving) await active.driving;
      await rm(join(active.directory, 'cleanup.json'), {force: true});
      await active.owner.release();
      if (this.active === active) this.active = undefined;
    } catch (error) { await this.retain(active, error); throw error; }
  }
}
