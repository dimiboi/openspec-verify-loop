import { parseArgs } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, realpath } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { connect } from './opencode.js';
import { createRun, resumeRun, stopRun } from './controller.js';
import { atomicWrite, defaultStateRoot, loadRun, RunStore, runDirectory } from './state.js';
import { setup } from './setup.js';
import { delay, digest, errorMessage, exists, LoopError, projectRoot, VERSION } from './util.js';

const help = `openspec-verify-loop ${VERSION}

node <skill>/scripts/controller.mjs <command> [options]

Commands:
  setup    Install /verify-loop and worker profiles; reload OpenCode afterwards
  run      Verify/fix an active change using fresh sequential sessions
  status   Read saved state without starting OpenCode
  resume   Explicitly recover a saved run
  stop     Interrupt a run and retain reports

Options:
  --project <directory>       Consuming Git checkout (default: .)
  --change <name>             Active change (automatic when exactly one exists)
  --run <run-id>              Required for status, resume, stop
  --state-dir <directory>     Run storage outside checkout and installed skill
  --skill <SKILL.md>          Explicit advertised OpenSpec verification procedure
  --verifier-model <model>    provider/model[#variant]
  --fixer-model <model>       provider/model[#variant]
  --server <url>              Explicit OpenCode 2.2.5 server (OPENCODE_TOKEN for auth)
  --max-rounds <number>       Optional verification round limit
  --max-minutes <number>      Optional wall-time limit, including downtime
  --replace                  Setup: replace reviewed customized template files
  --help                     Show this help
  --version                  Show controller version

Project configuration: .opencode/openspec-verify-loop.json
Precedence: CLI > project configuration > defaults. Progress and outcomes are JSON lines.
Exit codes: 0 clean/setup/status; 2 selection/no active change; 3 blocked/awaiting input;
4 execution/report failure; 5 limit; 130 interruption.
`;
const print = (value: unknown) => console.log(JSON.stringify(value));
export const exitCode = (outcome: string) => ({clean:0,setup_complete:0,selection_required:2,no_active_change:2,
  blocked:3,awaiting_input:3,stopping:3,failed:4,limited:5,interrupted:130}[outcome] ?? 4);

export async function main(args = process.argv.slice(2)): Promise<number> {
  const [major,minor] = process.versions.node.split('.').map(Number);
  if(!major || major<22 || (major===22 && (minor??0)<18)) throw new Error('Node.js 22.18 or later is required');
  const {values:v,positionals} = parseArgs({args,allowPositionals:true,strict:true,options:{
    project:{type:'string'},change:{type:'string'},run:{type:'string'},'state-dir':{type:'string'},skill:{type:'string'},
    'verifier-model':{type:'string'},'fixer-model':{type:'string'},server:{type:'string'},
    'max-rounds':{type:'string'},'max-minutes':{type:'string'},replace:{type:'boolean'},help:{type:'boolean'},version:{type:'boolean'},
  }});
  if(v.version) { console.log(VERSION); return 0; }
  if(v.help || !positionals.length) { console.log(help); return 0; }
  const action = positionals[0];
  if (positionals.length > 1 || !['setup','run','status','resume','stop'].includes(action!)) throw new Error('Expected one command; use --help');
  if (v.replace && action !== 'setup') throw new Error('--replace applies only to setup');
  if (v.change && action !== 'run') throw new Error('--change applies only to run');
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const skillDir = await exists(join(here,'SKILL.md')) ? here : resolve(here,'skills/openspec-verify-loop');
  if (action === 'setup') {
    print(await setup(v.project ?? '.', skillDir, v.replace)); return 0;
  }
  const project = await projectRoot(v.project ?? '.');
  const config = await loadConfig(project, {
    verifierModel:v['verifier-model'],fixerModel:v['fixer-model'],skill:v.skill,server:v.server,
    stateDir:v['state-dir'] ? resolve(v['state-dir']) : undefined,
    maxRounds:v['max-rounds'] === undefined ? undefined : Number(v['max-rounds']),
    maxMinutes:v['max-minutes'] === undefined ? undefined : Number(v['max-minutes']),
  });
  if (config.stateDir) config.stateDir = resolve(project,config.stateDir);
  const abort = new AbortController();
  const stop = () => abort.abort(new LoopError('interrupted','Stopped by user'));
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  try {
    if (action === 'run') {
      if (v.run) throw new Error('Use resume for an existing --run ID');
      const adapter = await connect(config.server);
      const s = await createRun(project,config,adapter,v.change,{signal:abort.signal,emit:print});
      return exitCode(s.phase);
    }
    if (!v.run) throw new Error('--run is required for status, resume, and stop');
    const root = await realpath(config.stateDir ?? defaultStateRoot());
    const runDir = runDirectory(root,project,v.run);
    const state = await loadRun(runDir,project);
    const store = new RunStore(state);
    if (action === 'status') {
      print({outcome:state.phase,runId:state.runId,runDir,round:state.round,change:state.pins.changeName,
        reason:state.reason,controllerPid:state.controllerPid,pending:state.pending ? {sessionId:state.pending.assignment.sessionId,role:state.pending.assignment.role} : undefined,
        requests:state.requests,workers:state.workers});
      return 0;
    }
    const ownerPid = action==='stop' ? await store.ownerPid() : null;
    if (action === 'stop') await atomicWrite(join(runDir,'stop.request'), {time:Date.now()});
    if (action === 'stop' && (state.controllerPid || ownerPid)) {
      const pid=ownerPid ?? state.controllerPid!;
      let running = true;
      try { process.kill(pid,0); } catch(e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') running = false; else throw e; }
      if (running) {
        await atomicWrite(join(runDir,'stop.request'), {time:Date.now()});
        for(let i=0;i<20;i++) {
          await delay(500,abort.signal);
          const current = await loadRun(runDir,project);
          if (!current.controllerPid && !(await store.ownerPid())) { print({outcome:current.phase,runId:current.runId,runDir,reason:current.reason}); return exitCode(current.phase); }
        }
        print({outcome:'stopping',runId:state.runId,runDir,reason:'Stop requested; controller is reconciling its worker. Check status before starting another run.'});
        return 3;
      }
    }
    if (action === 'resume' && digest(JSON.stringify(config)) !== digest(JSON.stringify(state.config))) {
      throw new LoopError('blocked','Effective loop configuration changed; use the original options to resume or start a new run');
    }
    const adapter = action==='stop' && !state.pending ? undefined : await connect(state.config.server);
    const s = action === 'stop' ? await stopRun(store,adapter) : await resumeRun(store,adapter!,{signal:abort.signal,emit:print});
    if (action === 'stop') print({outcome:s.phase,runId:s.runId,runDir,reason:s.reason});
    return exitCode(s.phase);
  } finally { process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop); }
}

// Node resolves import.meta.url through skill-installer symlinks; argv keeps the invoked path.
const entryPath = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(()=>undefined) : undefined;
if (entryPath === fileURLToPath(import.meta.url)) {
  main().then(code=>{process.exitCode=code;}).catch(e=>{
    print({outcome:e instanceof LoopError?e.outcome:'failed',reason:errorMessage(e),...(e instanceof LoopError && e.details !== undefined?{details:e.details}:{})});
    process.exitCode=exitCode(e instanceof LoopError?e.outcome:'failed');
  });
}
