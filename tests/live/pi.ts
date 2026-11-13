import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createModels } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { PiRuntime, readRecords, selectRun, type PiRun } from '../../src/pi-runtime.js';
import { hash } from '../../src/pi-context.js';
import { acquireOwnership, hasLiveOwner } from '../../src/pi-ownership.js';
import { loadScript } from '../../src/loop.js';
import { PiRpc, type PiConnection } from './pi-rpc.js';
import { snapshot } from './opencode.js';
import { Attempt, change, checked, checkWorkers, collectPages, command, independentChecks, isMain, lifecycle,
  options, help, pause, prepareFixture, type Command, type Options, type Worker } from './common.js';

type Dependencies = {
  run?: Command;
  connect?: (attempt: Attempt, agentDir: string, args: string[]) => PiConnection;
  inspect?: (attempt: Attempt, directory: string, run: PiRun) => Promise<void>;
  pause?: (signal: AbortSignal) => Promise<void>;
};

type SessionState = {model?: {provider: string; id: string}; thinkingLevel: string; sessionId: string};
type CommandInfo = {name: string; source: string; sourceInfo: {path: string}};
type Entry = {id: string; type: string; customType?: string; content?: string; details?: {event?: string; reason?: string}};
const rendered = (entries: Entry[]) => entries.find(entry => entry.type === 'custom_message' && entry.customType === 'openspec-verify-loop' &&
  entry.details?.event === 'report')?.content ?? '';

export function assertPiResume(attempt: Attempt, before: PiRun, after: PiRun) {
  attempt.check('Resume keeps run and round budget', before.id === after.id && before.maxAgentCalls === after.maxAgentCalls && before.args.maxRounds === after.args.maxRounds);
  attempt.check('Completed workers are not repeated', before.calls.every((call, i) => call.reply === null ||
    (after.calls[i]?.conversation === call.conversation && after.calls[i]?.submission === call.submission && after.calls[i]?.reply === call.reply)));
  const pending = before.calls.findIndex(call => call.reply === null);
  attempt.check('Pending worker is reattached without another admission', pending >= 0 && after.calls[pending]?.conversation === before.calls[pending]?.conversation &&
    after.calls[pending]?.submission === before.calls[pending]?.submission);
}

async function inspectWorkers(attempt: Attempt, directory: string, run: PiRun) {
  const owner = await acquireOwnership(directory);
  const runtime = await PiRuntime.open({directory, checkout: await realpath(attempt.fixture), models: createModels(), source: await loadScript()});
  try {
    for (const call of run.calls) {
      const conversation = await runtime.harness.conversation(call.conversation, context); assert(conversation);
      const agent = await conversation.agent(context);
      const entries = await collectPages(async (cursor?: string) => {
        const page = await conversation.entries({order: 'ascending'}, 500, cursor ? JSON.parse(cursor) : undefined, context);
        return {items: [...page.items], next: page.next ? JSON.stringify(page.next) : undefined};
      });
      const tasks = await collectPages(async (cursor?: string) => {
        const page = await runtime.harness.commit(tx => tx.scanTasks({conversationId: call.conversation}, 500, cursor ? JSON.parse(cursor) : undefined), context);
        return {items: [...page.items], next: page.next ? JSON.stringify(page.next) : undefined};
      });
      const started = tasks.flatMap(task => task.startedAt === undefined ? [] : [task.startedAt]);
      const ended = tasks.flatMap(task => task.endedAt === undefined ? [] : [task.endedAt]);
      const active = tasks.some(task => task.state.status !== 'terminal');
      attempt.result.workers.push({id: String(call.conversation), role: call.role, active,
        start: Math.min(...started), ...(ended.length ? {end: Math.max(...ended)} : {}),
        settings: {provider: agent.model?.provider, model: agent.model?.modelId, reasoning: agent.thinkingLevel}} satisfies Worker);
      await attempt.record('pi-workers', {call, agent: {model: agent.model, thinkingLevel: agent.thinkingLevel, cwd: agent.cwd,
        tools: agent.tools.map(tool => tool.name)}, entries, tasks});
      attempt.check(`Worker ${call.conversation} has one input admission`, entries.filter(entry => entry.kind === 'pi.user').length === 1);
      attempt.check(`Worker ${call.conversation} uses fixture cwd`, agent.cwd === await realpath(attempt.fixture));
    }
    attempt.check('Every worker is inactive', attempt.result.workers.every(worker => !worker.active));
  } finally {await runtime.close(false); await owner.release();}
}

export async function runPi(input: Options, dependencies: Dependencies = {}) {
  const run = dependencies.run ?? command;
  const sleep = dependencies.pause ?? pause;
  const attempt = await Attempt.create(input);
  const agentDir = join(attempt.root, 'pi-agent');
  let stateDirectory = '';
  let connection: PiConnection | undefined;
  let selected: SessionState | undefined;
  let beforeResume: PiRun | undefined;
  let current: PiRun | undefined;
  let launchCount = 0;
  let reported = false;
  let lastEntry: string | undefined;
  let args: string[] = [];
  const connect = async (signal: AbortSignal) => {
    lastEntry = undefined;
    connection = dependencies.connect?.(attempt, agentDir, args) ?? new PiRpc(attempt.fixture,
      {PI_CODING_AGENT_DIR: agentDir}, args, value => attempt.record('pi-rpc', value));
    const commands = await connection.request('get_commands', {}, signal) as {commands: CommandInfo[]};
    for (const name of ['opsx-verify-loop', 'opsx-verify-loop-stop', 'opsx-verify-loop-resume', 'opsx-verify-loop-report']) {
      assert(commands.commands.some(command => command.source === 'extension' && command.name === name), `Pi native command missing: ${name}`);
    }
    const skills = commands.commands.filter(command => command.source === 'skill' && command.name === 'skill:openspec-verify-change');
    assert.equal(skills.length, 1, 'Pi must advertise one verify procedure');
    assert.equal(await realpath(skills[0]!.sourceInfo.path), await realpath(String((attempt.result.procedure as {path: string}).path)));
    const state = await connection.request('get_state', {}, signal) as SessionState;
    assert.equal(state.model?.provider, input.provider, 'Pi selected another provider');
    assert.equal(state.model?.id, input.model, 'Pi selected another model');
    if (input.reasoning) assert.equal(state.thinkingLevel, input.reasoning, 'Pi selected another thinking level');
    selected = state; attempt.result.originId = state.sessionId;
    await attempt.record('pi-startup', {commands, state});
  };
  const native = async (text: string, signal: AbortSignal) => {
    assert(connection?.alive(), 'Fixture Pi process is not alive');
    const response = await connection!.request('prompt', {message: text}, signal) as {disposition: string};
    assert.equal(response.disposition, 'handled', 'Native command unexpectedly started a parent model turn');
    const messages = await connection!.request('get_entries', lastEntry ? {since: lastEntry} : {}, signal) as {entries: Entry[]};
    lastEntry = messages.entries.at(-1)?.id ?? lastEntry;
    await attempt.record('pi-command-entries', messages);
    const failure = messages.entries.find(entry => entry.type === 'custom_message' && entry.customType === 'openspec-verify-loop' && entry.details?.event === 'error');
    if (failure) throw new Error(`Native Pi command failed: ${failure.details!.reason}`);
    return messages.entries;
  };
  const observe = async () => {
    const saved = await readRecords(stateDirectory);
    current = selectRun(saved.runs, attempt.result.runId, true);
    attempt.result.runId = current.id;
    await attempt.record('pi-reports', saved);
    return current;
  };
  const code = await lifecycle(attempt, async signal => {
    const procedure = await prepareFixture(attempt, run);
    await mkdir(agentDir, {recursive: true, mode: 0o700});
    const plugin = await snapshot(attempt, run);
    const version = (await checked('pi', ['--version'], {cwd: attempt.fixture, env: {PI_CODING_AGENT_DIR: agentDir}, signal}, run)).trim();
    assert.equal(version, '1.5.2', `Pi 1.5.2 required; found ${version}`);
    const durable = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8')).dependencies['@earendil-works/pi-durable'];
    attempt.result.versions = {pi: version, durable};
    args = ['--no-extensions', '--no-mcp', '--no-skills', '--no-prompt-templates', '--approve',
      '--extension', plugin, '--skill', procedure, '--provider', input.provider, '--model', input.model,
      '--session-dir', join(attempt.root, 'sessions')];
    if (input.reasoning) args.push('--thinking', input.reasoning);
    if (input.providerExtension) args.push('--extension', await realpath(input.providerExtension));
    stateDirectory = join(agentDir, 'openspec-verify-loop', hash(await realpath(attempt.fixture)));
    attempt.result.piState = {directory: stateDirectory, authoritative: join(stateDirectory, 'store')};
    await connect(signal);
    attempt.result.stage = 'start'; launchCount++;
    await native(`/opsx-verify-loop ${change}`, signal);
    for (;;) {
      signal.throwIfAborted();
      try {await observe(); break;}
      catch (error) {if (!String(error).includes('No unfinished loop')) throw error; await sleep(signal);}
    }
    attempt.check('Exactly one native loop launch', launchCount === 1);
    attempt.check('Selected procedure reaches loop', current!.settings.procedurePath === procedure && current!.settings.procedureHash === hash(await readFile(procedure, 'utf8')));
    attempt.result.stage = 'observe';
    await attempt.save();
    for (;;) {
      const report = await observe();
      if (!reported && report.state === 'running' && report.calls.some(call => call.submission !== null && call.reply === null)) {
        reported = true;
        const before = (await readRecords(stateDirectory)).committed!;
        const text = rendered(await native(`/opsx-verify-loop-report ${report.id}`, signal));
        const after = (await readRecords(stateDirectory)).committed!;
        const shown = Date.parse(/^Last worker activity: (\S+) \(\d+ s before this report\)$/m.exec(text)?.[1] ?? '');
        attempt.check('Running report shows last worker activity', !Number.isNaN(shown), text);
        attempt.check('Report activity matches the store commit time', shown >= before - 5000 && shown <= after + 5000, {shown, before, after});
        continue;
      }
      if (input.scenario === 'stop') {
        if (report.state === 'terminal') {
          attempt.result.status = 'not_exercised'; attempt.result.errors.push(`Stop window was missed: ${JSON.stringify(report.result)}`); break;
        }
        if (report.calls.some(call => call.submission !== null && call.reply === null)) {
          await native(`/opsx-verify-loop-stop ${report.id}`, signal);
          const stopped = await observe();
          attempt.check('Native stop reports stopped', stopped.result?.status === 'stopped');
          attempt.check('No worker starts after stop', stopped.calls.length === report.calls.length);
          break;
        }
      } else if (input.scenario === 'resume' && !beforeResume && report.state !== 'terminal' && report.calls.some(call => call.reply !== null) &&
        report.calls.some(call => call.submission !== null && call.reply === null)) {
        beforeResume = report;
        await attempt.record('pi-before-restart', report);
        await connection!.close(signal, true);
        await connect(signal);
        const text = rendered(await native(`/opsx-verify-loop-report ${report.id}`, signal));
        attempt.check('Interrupted report shows no worker activity', text.startsWith(`OpenSpec loop ${report.id}: interrupted`) &&
          !text.includes('Last worker activity'), text);
        const inspected = await observe();
        const revision = (await readRecords(stateDirectory)).revision;
        await sleep(signal);
        attempt.check('Restart and report schedule no work', (await readRecords(stateDirectory)).revision === revision);
        attempt.check('Interrupted reports remain available', inspected.id === report.id && inspected.calls.length === report.calls.length);
        await native(`/opsx-verify-loop-resume ${report.id}`, signal);
      }
      if (report.state === 'terminal') {
        if (input.scenario === 'resume' && !beforeResume) {
          attempt.result.status = 'not_exercised'; attempt.result.errors.push(`Resume window was missed: ${JSON.stringify(report.result)}`); break;
        }
        attempt.check('Loop ended clean', report.result?.status === 'clean', report.result);
        if (beforeResume) assertPiResume(attempt, beforeResume, report);
        await independentChecks(attempt, signal, run);
        break;
      }
      await sleep(signal);
    }
    attempt.result.terminal = current?.result as Record<string, unknown> | undefined;
    const messages = await connection!.request('get_entries', {}, signal) as {entries: {message?: {role?: string}}[]};
    await attempt.record('pi-parent-entries', messages);
    attempt.check('Parent reporting uses no model turn', !messages.entries.some(entry => entry.message?.role === 'assistant'));
  }, async signal => {
    if (!stateDirectory) {await connection?.close(signal); attempt.result.cleanup.confirmed = true; return;}
    if (connection?.alive()) {
      try {
        let report: PiRun | undefined;
        try {report = await observe();} catch { /* An unsuccessful start may have no report yet. */ }
        if (report && report.state !== 'terminal') {
          await native(`/opsx-verify-loop-stop ${report.id}`, signal);
          await observe();
        }
      } finally {await connection.close(signal);}
    }
    if (await hasLiveOwner(stateDirectory)) throw new Error('Pi checkout ownership is still live after cleanup');
    if (current) {
      await (dependencies.inspect ?? inspectWorkers)(attempt, stateDirectory, current);
      checkWorkers(attempt, {provider: input.provider, model: input.model, reasoning: selected?.thinkingLevel});
    }
    attempt.result.cleanup.confirmed = !attempt.result.workers.some(worker => worker.active);
    await connection?.flush();
  });
  if (code === 0 && attempt.result.assertions.some(check => !check.passed)) {
    attempt.result.status = 'failed'; await attempt.save(); return {attempt, code: 1};
  }
  return {attempt, code};
}

if (isMain(import.meta.url)) {
  try {
    const input = options('pi', process.argv.slice(2));
    if (!input) console.log(help('pi'));
    else {const {attempt, code} = await runPi(input); console.log(`Pi ${input.scenario}: ${attempt.result.status}. Evidence: ${attempt.evidence}`); process.exitCode = code;}
  } catch (error) {console.error(String(error)); process.exitCode = 1;}
}
