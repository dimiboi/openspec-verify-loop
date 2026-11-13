import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OpenCode, type OpenCodeClient, type SessionInfo, type SessionMessageInfo } from '@opencode/client';
import { Service } from '@opencode/client/service';
import { OPENCODE_VERSION } from '../../src/util.js';
import { Attempt, change, checked, checkWorkers, collectPages, command, hashes, help, independentChecks,
  isMain, lifecycle, notices, options, pause, prepareFixture, repository, type Command, type Options } from './common.js';

export async function snapshot(attempt: Attempt, run = command) {
  const target = join(attempt.root, 'plugin'); await mkdir(target);
  const pkg = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  const resources: string[] = ['package.json', 'package-lock.json', 'README.md', ...pkg.files];
  for (const file of resources) await cp(join(repository, file), join(target, file), {recursive: true});
  const identity = await hashes(target);
  await attempt.record('snapshot-install', await checked('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: target}, run));
  attempt.result.plugin = {source: repository, revision: (await checked('git', ['rev-parse', 'HEAD'], undefined, run)).trim(),
    dirty: await checked('git', ['status', '--porcelain'], undefined, run), snapshot: target, hashes: identity};
  return target;
}

export async function connectExisting(): Promise<OpenCodeClient> {
  const endpoint = await Service.discover({version: OPENCODE_VERSION});
  assert(endpoint, `No compatible existing OpenCode ${OPENCODE_VERSION} service; start it separately before testing`);
  return OpenCode.make({baseUrl: endpoint.url, headers: Service.headers(endpoint)});
}
export function modelSettings(model: SessionInfo['model']) {
  return {provider: model?.providerID, model: model?.id, variant: model?.variant ?? 'default'};
}
export function reportingChecks(messages: SessionMessageInfo[]) {
  const checks: {id: string; complete: boolean; tools: number; succeeded: boolean}[] = [];
  for (let i = 0; i < messages.length; i++) {
    const notice = messages[i]!;
    if (notice.type !== 'synthetic' || notice.metadata?.openspecLoopNotice !== true) continue;
    let complete = false, tools = 0, succeeded = false;
    for (const tail of messages.slice(i + 1)) {
      if (tail.type === 'user' || tail.type === 'synthetic') break;
      if (tail.type === 'assistant') {
        tools += tail.content.filter(c => c.type === 'tool').length;
        // A queued notice can follow the final response without an intervening idle record.
        complete = !!tail.time.completed;
        succeeded = complete && tail.finish === 'stop' && !tail.error;
      }
      if (tail.type === 'idle') { complete = true; succeeded = succeeded && tail.outcome === 'succeeded'; break; }
    }
    checks.push({id: notice.id, complete, tools, succeeded});
  }
  return checks;
}

export async function runOpenCode(input: Options, deps: {connect?: () => Promise<OpenCodeClient>; run?: Command} = {}) {
  const attempt = await Attempt.create(input), run = deps.run ?? command;
  let client: OpenCodeClient | undefined, startAttempted = false, originAdmitted = false;
  let stopRequested = false, stoppedIds: string[] = [], workerSessions: SessionInfo[] = [];
  const request = (signal: AbortSignal) => ({signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)])});
  const readMessages = (id: string, signal: AbortSignal) => collectPages<SessionMessageInfo, string>(async cursor => {
    const page = await client!.message.list({sessionID: id, limit: 100, ...(cursor ? {cursor} : {order: 'asc'})}, request(signal));
    return {items: page.data, next: page.cursor.next};
  }, signal);
  const sessions = (signal: AbortSignal) => collectPages<SessionInfo, string>(async cursor => {
    const page = await client!.session.list({directory: attempt.fixture, limit: 100, ...(cursor ? {cursor} : {order: 'asc'})}, request(signal));
    return {items: page.data, next: page.cursor.next};
  }, signal);
  async function observe(signal: AbortSignal) {
    const origin = await client!.session.get({sessionID: attempt.result.originId!}, request(signal));
    const messages = await readMessages(origin.id, signal);
    const inbox = await client!.session.inbox.list({sessionID: origin.id}, request(signal));
    const all = await sessions(signal);
    const marked = all.filter(s => typeof s.metadata?.openspecVerifyLoop === 'string');
    const ns = notices(messages, inbox);
    const started = ns.filter(n => n.value.outcome === 'started');
    const ids = new Set([...started.map(n => n.value.runId), ...marked.map(s => s.metadata!.openspecVerifyLoop)]);
    assert(ids.size <= 1, 'Multiple runs observed in one fixture');
    if (ids.size) { const id = [...ids][0]; assert(typeof id === 'string'); attempt.result.runId = id; }
    const terminals = ns.filter(n => n.value.runId === attempt.result.runId && typeof n.value.status === 'string');
    assert(terminals.length <= 1, 'More than one terminal notice');
    attempt.result.terminal = terminals[0]?.value;
    workerSessions = marked.filter(s => s.metadata!.openspecVerifyLoop === attempt.result.runId).sort((a, b) => a.time.created - b.time.created);
    const active = await client!.session.active(request(signal));
    attempt.result.workers = workerSessions.map(s => {
      const match = /^OpenSpec (verifier|fixer) \d+:/.exec(s.title ?? '');
      assert(match, `Unknown worker role: ${s.id}`);
      const busy = !!active[s.id] || (s.time.busy ?? 0) > (s.time.idle ?? 0);
      return {id: s.id, role: match[1] as 'verifier' | 'fixer', start: s.time.created,
        end: s.outcome && !busy ? s.time.idle : undefined, settings: modelSettings(s.model), active: busy};
    });
    for (const worker of workerSessions) {
      const wm = await readMessages(worker.id, signal);
      await attempt.record(`worker-${worker.id}`, {session: worker, messages: wm, inbox: await client!.session.inbox.list({sessionID: worker.id}, request(signal))});
      const verifier = worker.title?.includes('verifier');
      if (verifier) {
        const prompt = wm.find(m => m.type === 'user');
        if (prompt?.type === 'user') {
          const expected = (attempt.result.procedure as {path: string}).path;
          attempt.result.procedureSelected = prompt.text.includes(expected);
        }
      }
    }
    await attempt.record('origin', {session: origin, messages, inbox});
    await attempt.record('sessions', all);
    await attempt.save();
    return {origin, messages, inbox, ns, started, terminals, active};
  }
  const publicStop = async (signal: AbortSignal) => {
    await client!.session.command({sessionID: attempt.result.originId!, name: 'opsx-verify-loop-stop', text: ''}, request(signal));
  };
  const code = await lifecycle(attempt, async signal => {
    const boundedRun: Command = (file, args, opts) => run(file, args, {...opts, signal});
    await prepareFixture(attempt, boundedRun);
    const plugin = await snapshot(attempt, boundedRun);
    await writeFile(join(attempt.fixture, 'opencode.json'), JSON.stringify({plugins: [plugin]}, null, 2) + '\n');
    // Treat host configuration as part of the recorded starting checkout.
    await checked('git', ['add', 'opencode.json'], {cwd: attempt.fixture, signal}, run);
    await checked('git', ['-c', 'user.name=Live test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Configure project plugin'], {cwd: attempt.fixture, signal}, run);
    attempt.result.fixtureRevision = (await checked('git', ['rev-parse', 'HEAD'], {cwd: attempt.fixture, signal}, run)).trim();
    client = await (deps.connect ?? connectExisting)();
    const info = await client.server.info(request(signal));
    assert.equal(info.version, OPENCODE_VERSION, 'Existing host version mismatch');
    attempt.result.hostInfo = {version: info.version, pid: info.pid};
    const location = {directory: attempt.fixture};
    await client.location.get({location}, request(signal));
    for (;;) {
      signal.throwIfAborted();
      const [plugins, cmds, skills, models] = await Promise.all([
        client.plugin.list({location}, request(signal)), client.command.list({location}, request(signal)),
        client.skill.list({location}, request(signal)), client.model.list({location}, request(signal)),
      ]);
      const procedures = skills.data.filter(s => s.id === 'openspec-verify-change' || s.name === 'openspec-verify-change');
      const entry = plugins.data.find(p => p.id === 'openspec.verify-loop');
      if (entry?.state.status === 'failed') throw new Error(`Plugin failed to load: ${entry.state.error}`);
      const loaded = entry?.state.status === 'active';
      await attempt.record('catalogue', {plugins, commands: cmds, skills, models: models.data.map(m => ({providerID: m.providerID, id: m.id, enabled: m.enabled, variants: m.variants.map(v => v.id)}))});
      if (!loaded || !['opsx-verify-loop', 'opsx-verify-loop-stop'].every(name => cmds.data.some(c => c.name === name)) || !skills.data.some(s => s.id === 'openspec-verify-loop')) {
        await pause(signal); continue;
      }
      assert(entry.source.type === 'package' ? resolve(entry.source.target) === plugin :
        entry.source.type === 'local' && [plugin, join(plugin, 'dist/index.js')].includes(resolve(entry.source.path)), 'Host loaded a different plugin source');
      assert.equal(procedures.length, 1, `Expected one verify procedure: ${procedures.map(s => s.path).join(', ')}`);
      assert.equal(resolve(procedures[0]!.path), (attempt.result.procedure as {path: string}).path);
      assert(models.data.some(m => m.enabled && m.providerID === input.provider && m.id === input.model &&
        (input.variant === 'default' || m.variants.some(v => v.id === input.variant))), 'Selected model/variant unavailable');
      break;
    }
    // Assign the identity before creation so a lost create response can be reconciled without another session.
    attempt.result.originId = `ses_${randomUUID().replaceAll('-', '')}`;
    await attempt.save();
    try {
      await client.session.create({id: attempt.result.originId, title: 'Greeting verification', location,
        model: {providerID: input.provider, id: input.model, variant: input.variant}}, request(signal));
      originAdmitted = true;
    } catch (e) {
      const saved = await client.session.get({sessionID: attempt.result.originId}, request(signal));
      assert.equal(saved.id, attempt.result.originId); originAdmitted = true;
      await attempt.record('creation-reconciliation', {error: String(e), session: saved});
    }
    attempt.result.stage = 'execution'; startAttempted = true;
    try { await client.session.command({sessionID: attempt.result.originId, name: 'opsx-verify-loop', text: change}, request(signal)); }
    catch (e) { await attempt.record('uncertain-start', {error: String(e)}); }
    attempt.result.stage = 'observation';
    for (;;) {
      const observed = await observe(signal);
      const busy = attempt.result.workers.filter(w => w.active);
      if (input.scenario === 'stop' && !stopRequested && busy.length && !observed.terminals.length) {
        stoppedIds = busy.map(w => w.id); stopRequested = true; await publicStop(signal);
        await attempt.record('stop-request', {workers: stoppedIds});
      }
      const reports = reportingChecks(observed.messages);
      if (observed.terminals.length && !observed.inbox.length && !observed.active[observed.origin.id] &&
        reports.length === observed.ns.length && reports.every(r => r.complete)) {
        attempt.result.stage = 'assertion';
        attempt.check('One start and one terminal notice', observed.started.length === 1 && observed.terminals.length === 1);
        attempt.check('Reporting turns use no tools', reports.length === 2 && reports.every(r => r.tools === 0 && r.complete && r.succeeded));
        attempt.check('Verifier used supplied procedure', attempt.result.procedureSelected === true);
        checkWorkers(attempt, {provider: input.provider, model: input.model, variant: input.variant});
        if (input.scenario === 'fix-to-clean') await independentChecks(attempt, signal, run);
        else {
          if (!stopRequested || attempt.result.terminal?.status === 'clean') attempt.result.status = 'not_exercised';
          attempt.check('Normal stop while worker active', stopRequested && attempt.result.terminal?.status === 'stopped');
          const lastStoppedIndex = Math.max(...stoppedIds.map(id => attempt.result.workers.findIndex(w => w.id === id)));
          attempt.check('No workers after stop', lastStoppedIndex === attempt.result.workers.length - 1);
        }
        break;
      }
      await pause(signal);
    }
  }, async signal => {
    if (!client || !attempt.result.originId) { attempt.result.cleanup.confirmed = !startAttempted; return; }
    if (!originAdmitted) throw new Error(`Origin admission uncertain: ${attempt.result.originId}`);
    // Discover workers even after a lost command response, never dispatch the start again.
    let observed = await observe(signal);
    if (startAttempted && !attempt.result.runId) throw new Error('Run admission is unknown; inspect the retained origin');
    if (!attempt.result.terminal || attempt.result.workers.some(w => w.active)) {
      try { await publicStop(signal); } catch (e) { await attempt.record('cleanup-stop-error', String(e)); }
    }
    observed = await observe(signal);
    const known = [...workerSessions.map(s => s.id), attempt.result.originId];
    for (const id of known) {
      const inbox = await client.session.inbox.list({sessionID: id}, request(signal));
      if (observed.active[id] || inbox.length) {
        attempt.result.cleanup.fallback = true;
        await attempt.record('native-cleanup', {sessionId: id});
        for (const item of inbox) await client.session.inbox.cancel({sessionID: id, inboxID: item.id}, request(signal));
        await client.session.interrupt({sessionID: id, resume: false}, request(signal));
        await client.experimental.session.wait({sessionID: id}, request(signal));
      }
    }
    const active = await client.session.active(request(signal));
    for (const id of known) {
      const s = await client.session.get({sessionID: id}, request(signal));
      const inbox = await client.session.inbox.list({sessionID: id}, request(signal));
      assert(!active[id] && !inbox.length && (s.time.busy ?? 0) <= (s.time.idle ?? 0), `Session is still active: ${id}`);
    }
    attempt.result.cleanup.confirmed = true;
    if (input.scenario === 'stop' && attempt.result.cleanup.fallback) attempt.check('Stop succeeded without emergency fallback', false);
    if (attempt.result.assertions.some(c => !c.passed) && attempt.result.status === 'passed') attempt.result.status = 'failed';
  });
  return {attempt, code};
}

if (isMain(import.meta.url)) {
  try {
    const input = options('opencode', process.argv.slice(2));
    if (!input) console.log(help('opencode'));
    else { const {attempt, code} = await runOpenCode(input); console.log(`${attempt.result.status}: ${attempt.evidence}/summary.md`); process.exitCode = code; }
  } catch (e) { console.error(String(e)); process.exitCode = 1; }
}
