import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context, withAbortSignal, type Context } from '@earendil-works/chord/context';
import { createModels, type Models } from '@earendil-works/pi-ai';
import { AssistantEntry, configure, createRegistry, defineDoc, defineExtension, defineTask, Harness,
  type ConversationId, type SubmissionId, type TaskId, type TaskRuntime, type Storage } from '@earendil-works/pi-durable';
import { CodingTools } from '@earendil-works/pi-durable/tools';
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import { runScript, type AgentOptions, type LoopResult } from './loop.js';
import { hash, type PiArguments, type PiSettings } from './pi-context.js';
import { SupervisedEnv, reconcileCommands } from './pi-process.js';
import { errorMessage, newId, projectRoot } from './util.js';

export type PiCall = {
  prompt: string; role: 'verifier' | 'fixer'; label: string; conversation: ConversationId;
  submission: SubmissionId | null; admission: 'created' | 'attempting' | 'admitted'; requestId: string; reply: string | null; failure: string | null;
};
export type PiResult = LoopResult | {status: 'failed' | 'stopped'; reason: string};
export type PiRun = {
  id: string; version: number; created: number; settings: PiSettings;
  args: {change: string | null; store: string | null; maxRounds: number};
  maxAgentCalls: number; loopHash: string; task: TaskId<null> | null;
  state: 'running' | 'interrupted' | 'stopping' | 'terminal';
  calls: PiCall[]; result: PiResult | null; cleanup: string | null;
};
export type PiBook = {revision: number; runs: PiRun[]};
export const PiRecords = defineDoc<PiBook>({kind: 'openspec.loop.records', version: 1, scope: 'session',
  initial: () => ({revision: 0, runs: []}), checkpointWhen: () => true});
export class PiTerminalRunError extends Error {}
type Coordinator = TaskRuntime<{id: string}, {phase: 'run'}, null, object>;
type RuntimeOptions = {
  directory: string; checkout: string; source: string; models: Models;
  env?: (cwd: string) => ExecutionEnv;
  storage?: Storage;
  progress?: (run: PiRun) => void;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function selectRun(runs: readonly PiRun[], id?: string, report = false): PiRun {
  if (id) {
    const run = runs.find(run => run.id === id);
    if (!run) throw new Error(`Unknown run ${id} in this checkout`);
    return clone(run);
  }
  const unfinished = runs.filter(run => run.state !== 'terminal');
  if (unfinished.length > 1) throw new Error('Several unfinished runs exist; supply a run ID');
  const run = unfinished[0] ?? (report ? runs.at(-1) : undefined);
  if (!run) throw new Error('No unfinished loop in this checkout');
  return clone(run);
}

/**
 * Read the records without ownership: the read-only open creates and writes nothing and schedules no work.
 * `committed` is when the store last committed; while a worker is pending, only that worker commits.
 */
export async function readRecords(directory: string): Promise<PiBook & {committed?: number}> {
  const store = join(directory, 'store');
  let committed: number;
  try { committed = (await stat(join(store, 'main.jsonl'))).mtimeMs; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {revision: 0, runs: []}; throw error; }
  let storage: Storage;
  for (let attempt = 1; ; attempt++) {
    try { storage = await openNodeJsonlStorage(store, context, {readOnly: true}); break; }
    catch (error) {
      // Durable 1.5.1 and 1.5.2 do not retry an open whose listing raced the writer removing a reclaimed file.
      if (attempt === 5 || (error as {cause?: {code?: string}}).cause?.code !== 'not_found') throw error;
    }
  }
  const harness = await Harness.open(storage, {readOnly: true, registry: createRegistry(), models: createModels()}, context);
  try { return {...clone(await harness.snapshot(PiRecords, context) ?? {revision: 0, runs: []}), committed}; }
  finally { await harness.close(context); }
}

/** One exclusively owned Durable store. Opening it never starts the scheduler. */
export class PiRuntime {
  private constructor(readonly harness: Harness, private options: RuntimeOptions) {}
  private closing = false;
  private closePromise: Promise<void> | undefined;
  private storeClosing = false;
  private environments = new Map<string, ExecutionEnv>();
  private coordinator!: ReturnType<typeof defineTask<{id: string}, {phase: 'run'}, null>>;

  static async open(options: RuntimeOptions): Promise<PiRuntime> {
    await mkdir(options.directory, {recursive: true, mode: 0o700});
    let instance: PiRuntime;
    const coordinator = defineTask<{id: string}, {phase: 'run'}, null>({
      name: 'openspec.loop.coordinator', version: 1, initial: () => ({phase: 'run'}),
      phases: {run: (task, runtime, ctx) => instance.coordinate(task.input.id, runtime, ctx)},
      abort: async (_task, runtime, ctx) => {
        await runtime.commit(() => ({status: 'terminal', outcome: {status: 'aborted'}}), ctx);
      },
    });
    const registry = createRegistry();
    registry.install(CodingTools);
    registry.install(defineExtension({name: 'openspec-loop-coordinator', tasks: [coordinator]}));
    const storage = options.storage ?? await openNodeJsonlStorage(join(options.directory, 'store'), context, {fsync: true});
    const harness = await Harness.open(storage, {models: () => options.models, registry, env: ({cwd}) => {
      if (instance.closing) throw new Error('Pi loop is closing');
      const directory = cwd ?? options.checkout;
      let env = instance.environments.get(directory);
      if (!env) {
        env = options.env?.(directory) ?? new SupervisedEnv(directory, join(options.directory, 'commands'));
        instance.environments.set(directory, env);
      }
      return env;
    }}, context);
    instance = new PiRuntime(harness, options);
    instance.coordinator = coordinator;
    return instance;
  }

  async book(): Promise<PiBook> { return clone(await this.harness.snapshot(PiRecords, context) ?? {revision: 0, runs: []}); }
  async get(id?: string, report = false): Promise<PiRun> { return selectRun((await this.book()).runs, id, report); }
  setModels(models: Models): void { this.options.models = models; }

  async create(settings: PiSettings, args: PiArguments): Promise<PiRun> {
    const root = await this.harness.root(context);
    const id = newId('run');
    await root.commit(async tx => {
      const book = await tx.doc(PiRecords);
      const existing = book.runs.find(run => run.state !== 'terminal');
      if (existing) throw new Error(`Unfinished run ${existing.id}; resume or stop it before starting another`);
      const task = await tx.createTask(this.coordinator, {id}, {ownership: {kind: 'conversation'}});
      book.runs.push({id, version: 1, created: Date.now(), settings,
        args: {change: args.change ?? null, store: args.store ?? null, maxRounds: args.maxRounds}, maxAgentCalls: Number.MAX_SAFE_INTEGER,
        loopHash: hash(this.options.source), task, state: 'running', calls: [], result: null, cleanup: null});
      book.revision++;
    }, context);
    return this.get(id);
  }

  async compatible(run: PiRun): Promise<void> {
    if (run.version !== 1 || run.loopHash !== hash(this.options.source)) throw new Error('Run was created with an incompatible loop or adapter version');
    if (run.settings.checkout !== this.options.checkout || await projectRoot(run.settings.directory) !== this.options.checkout ||
      await realpath(run.settings.directory) !== run.settings.directory) throw new Error('The saved invoking directory or checkout changed');
    if (hash(await readFile(run.settings.procedurePath, 'utf8')) !== run.settings.procedureHash) throw new Error('The saved verify procedure changed');
    if (!run.task) throw new Error('Run is missing its coordinator identity');
    const task = await this.harness.getTask(run.task, context);
    if (!task || task.kind !== this.coordinator.definition.name || task.version !== this.coordinator.definition.version) throw new Error('Run coordinator is incompatible or missing');
  }

  async resume(id: string): Promise<void> {
    const run = await this.get(id);
    if (run.state === 'terminal') throw new Error(`Run ${id} is terminal and cannot be resumed`);
    if (run.state === 'stopping') throw new Error(`Run ${id} has a stop request; retry stop`);
    await this.compatible(run);
    await this.validateReplay(run);
    await reconcileCommands(join(this.options.directory, 'commands'), false);
    await this.update(id, run => {run.state = 'running'; run.cleanup = null;});
    this.harness.resume();
  }

  private async validateReplay(run: PiRun): Promise<void> {
    const boundary = new Error('Replay reached unfinished work');
    let position = 0;
    try {
      await runScript(this.options.source, {args: {...run.args, procedurePath: run.settings.procedurePath},
        budget: () => ({maxAgentCalls: run.maxAgentCalls}), phase: () => {}, log: () => {},
        agent: async (prompt, opts) => {
          const call = run.calls[position++];
          if (call && (call.prompt !== prompt || call.role !== (opts?.phase === 'Verify' ? 'verifier' : 'fixer'))) {
            throw new Error(`Worker call ${position - 1} replay mismatch`);
          }
          if (call?.reply !== undefined && call.reply !== null) return call.reply;
          throw boundary;
        },
      });
    } catch (error) { if (error !== boundary) throw error; }
  }

  start(): void { this.harness.resume(); }

  async wait(id: string): Promise<PiRun> {
    const run = await this.get(id);
    if (!run.task) throw new Error('Run is missing its coordinator identity');
    const task = await this.harness.waitForTask(run.task, context);
    await reconcileCommands(join(this.options.directory, 'commands'), true);
    await this.update(id, current => {
      if (!current.result) current.result = {status: 'failed', reason: `Coordinator ended ${task.state.outcome.status}`};
      if (current.state === 'stopping') current.result = {status: 'stopped', reason: 'Stopped by user'};
      current.state = 'terminal'; current.cleanup = null;
    });
    return this.get(id);
  }

  async stop(id: string, cleanupRetry = false): Promise<PiRun> {
    let task: TaskId<null> | null = null;
    let terminal = false;
    await this.harness.commit(async tx => {
      const book = await tx.doc(PiRecords);
      const run = book.runs.find(run => run.id === id);
      if (!run) throw new Error(`Unknown run ${id}`);
      if (run.state === 'terminal') {
        if (!cleanupRetry && !run.cleanup) throw new PiTerminalRunError(`Run ${id} is already terminal`);
        terminal = true;
      } else {run.state = 'stopping'; task = run.task; book.revision++;}
    }, context);
    if (terminal) {
      await reconcileCommands(join(this.options.directory, 'commands'), true);
      await this.update(id, current => {current.result = {status: 'stopped', reason: 'Stopped by user after cleanup'}; current.cleanup = null;});
      return this.get(id);
    }
    if (!task) throw new Error('Run is missing its coordinator identity');
    // Commit the abort mark before wait enables scheduling after a restart.
    await this.harness.abortTask(task, context);
    return this.wait(id);
  }

  async retainFailure(id: string, error: unknown): Promise<void> {
    await this.update(id, run => {run.cleanup = errorMessage(error);});
  }

  private async update(id: string, change: (run: PiRun) => void): Promise<void> {
    await this.harness.commit(async tx => {
      const book = await tx.doc(PiRecords);
      const run = book.runs.find(run => run.id === id);
      if (!run) throw new Error(`Unknown run ${id}`);
      change(run); book.revision++;
    }, context);
  }

  close(suspend = true): Promise<void> {
    return this.closePromise ??= this.closeOwned(suspend).catch(error => {this.closePromise = undefined; throw error;});
  }

  private async closeOwned(suspend: boolean): Promise<void> {
    this.closing = true;
    if (suspend && !this.storeClosing) {
      await this.harness.commit(async tx => {
        const book = await tx.doc(PiRecords);
        for (const run of book.runs) if (run.state === 'running') run.state = 'interrupted';
        book.revision++;
      }, context);
    }
    this.storeClosing = true;
    await this.harness.close(context);
    for (const env of this.environments.values()) await env.cleanup(context);
    await reconcileCommands(join(this.options.directory, 'commands'), true);
  }

  private async coordinate(id: string, runtime: Coordinator, ctx: Context): Promise<void> {
    const signalContext = withAbortSignal(runtime.signal, ctx);
    let outcome: PiResult;
    try {
      const run = await this.get(id);
      let position = 0;
      outcome = await runScript(this.options.source, {args: {...run.args, procedurePath: run.settings.procedurePath},
        budget: () => ({maxAgentCalls: run.maxAgentCalls}), phase: () => {}, log: () => {},
        agent: (prompt, opts) => this.worker(id, position++, prompt, opts, runtime, signalContext),
      }) as LoopResult;
    } catch (error) {
      if (this.closing || runtime.signal.aborted) return;
      outcome = {status: 'failed', reason: errorMessage(error)};
    }
    if (this.closing || runtime.signal.aborted) return;
    await runtime.commit(async tx => {
      const book = await tx.doc(PiRecords);
      const run = book.runs.find(run => run.id === id)!;
      run.result = outcome; book.revision++;
      if (outcome.status === 'failed' && run.calls.at(-1)?.reply === null) run.calls.at(-1)!.failure = outcome.reason;
      return outcome.status === 'failed' ? {status: 'terminal', outcome: {status: 'failed', error: {message: outcome.reason}}}
        : {status: 'terminal', outcome: {status: 'completed', result: null}};
    }, signalContext);
  }

  private async worker(id: string, position: number, prompt: string, opts: AgentOptions = {}, runtime: Coordinator, ctx: Context): Promise<string> {
    runtime.signal.throwIfAborted();
    if (this.closing) throw new Error('Pi loop is closing');
    const role = opts.phase === 'Verify' ? 'verifier' : 'fixer';
    let run = await this.get(id);
    let call = run.calls[position];
    if (call && (call.prompt !== prompt || call.role !== role)) throw new Error(`Worker call ${position} replay mismatch`);
    if (call?.failure) throw new Error(call.failure);
    if (call?.reply !== null && call?.reply !== undefined) return call.reply;
    if (!call) {
      await runtime.commit(async tx => {
        const book = await tx.doc(PiRecords);
        const current = book.runs.find(run => run.id === id)!;
        if (current.state !== 'running' || this.closing) throw new Error('Run is no longer dispatching workers');
        const conversation = await tx.createConversation({ownership: {kind: 'task', taskId: runtime.taskId}});
        const tools = CodingTools.tools!.filter(tool => role === 'fixer' || ['read', 'bash'].includes(tool.name));
        await configure(tx, conversation.id, {model: current.settings.model, thinkingLevel: current.settings.thinkingLevel,
          cwd: current.settings.directory, instructions: current.settings.instructions, extensions: [CodingTools], tools});
        current.calls.push({prompt, role, label: opts.label ?? role, conversation: conversation.id,
          submission: null, admission: 'created', requestId: `${id}:${position}`, reply: null, failure: null});
        book.revision++;
      }, ctx);
      run = await this.get(id); call = run.calls[position]!;
      this.options.progress?.(run);
    }
    const conversation = await runtime.conversation(call.conversation, ctx);
    if (!conversation) throw new Error(`Missing worker conversation ${call.conversation}`);
    if (call.submission === null) {
      if (call.admission !== 'created') throw new Error(`Worker ${call.conversation} admission is uncertain; the prompt will not be resubmitted`);
      const pendingCall = call;
      await runtime.commit(async tx => {
        const book = await tx.doc(PiRecords);
        book.runs.find(run => run.id === id)!.calls[position]!.admission = 'attempting'; book.revision++;
      }, ctx);
      try {
        await runtime.commit(async tx => {
          const book = await tx.doc(PiRecords);
          const current = book.runs.find(run => run.id === id)!;
          if (current.state !== 'running' || this.closing) throw new Error('Run is no longer dispatching workers');
          const existing = await tx.submissionByRequest(pendingCall.conversation, pendingCall.requestId);
          if (existing) throw new Error(`Unexpected input in worker ${pendingCall.conversation}`);
          current.calls[position]!.submission = await conversation.submit(tx, {type: 'input', content: prompt, requestId: pendingCall.requestId});
          current.calls[position]!.admission = 'admitted';
          book.revision++;
        }, ctx);
      } catch (error) {
        // Admission and its receipt are one commit. Never issue the prompt again.
        const observed = (await this.get(id)).calls[position]!;
        if (observed.submission === null) throw new Error(`Worker ${call.conversation} admission failed or is uncertain: ${errorMessage(error)}`);
      }
      call = (await this.get(id)).calls[position]!;
    }
    const submission = await this.harness.submission(call.submission!, ctx);
    if (!submission) throw new Error(`Missing worker submission ${call.submission}`);
    const settled = await submission.wait(ctx);
    if (settled.conversationId !== call.conversation || settled.requestId !== call.requestId || settled.status !== 'done' || settled.type !== 'input') {
      throw new Error(`Worker ${call.conversation} ended ${settled.status}${settled.status === 'unanswered' ? `: ${settled.reason}` : ''}`);
    }
    const entry = await this.harness.commit(tx => tx.entry(AssistantEntry, settled.answer), ctx);
    const message = entry?.model?.findLast(message => message.role === 'assistant');
    if (!message || message.role !== 'assistant' || message.stopReason !== 'stop' || message.errorMessage ||
      message.provider !== run.settings.model.provider || message.model !== run.settings.model.modelId) {
      throw new Error(`Worker ${call.conversation} ended without a complete final response from its assigned model`);
    }
    const reply = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    await runtime.commit(async tx => {
      const book = await tx.doc(PiRecords);
      book.runs.find(run => run.id === id)!.calls[position]!.reply = reply; book.revision++;
    }, ctx);
    return reply;
  }
}
