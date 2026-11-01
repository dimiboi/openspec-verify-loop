import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { workerPrompt } from '../src/prompts.js';
import { configSchema } from '../src/config.js';
import type { RunState } from '../src/state.js';
import type { Evidence } from '../src/openspec.js';
import type { CommandResult } from '../src/util.js';

const findingMarker = 'All prior/unresolved findings requiring disposition (none may be dropped):';
const verifierMarker = 'Latest verification checks and resolutions (findings are supplied once above; check prior evidence against the current workspace):';
const fixerMarker = 'Latest fixer dispositions (claims require independent verification):';
const evidenceMarker = "Controller's independent current check evidence (failures/incomplete tasks prevent clean; excerpts retain actual exit status; full output is saved):";
const reportMarker = 'Complete JSON, Markdown, and raw reports remain saved at these paths; consult them for additional detail:';

function section(prompt: string, marker: string) {
  const value = prompt.split(`${marker}\n`)[1];
  assert(value, `Missing prompt section: ${marker}`);
  return JSON.parse(value.split('\n\n')[0]!);
}

async function promptState(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'loop-prompts-'));
  t.after(() => rm(base, {recursive:true,force:true}));
  const project = join(base, 'consumer with spaces');
  const procedurePath = join(project, '.opencode/skills/openspec-verify-change/SKILL.md');
  const procedure = 'UNIQUE_PINNED_PROCEDURE: inspect all artifacts, implementation, and tests.\nRead references/checks.md when needed.';
  await mkdir(dirname(procedurePath), {recursive:true});
  await writeFile(procedurePath, procedure);
  const snapshot = {hash:'reviewed-workspace',head:'checkout-head',files:{'src/greet.ts':'source-hash'}};
  const model = {providerID:'fake',id:'test'};
  const state: RunState = {
    schemaVersion:2,pluginVersion:'0.2.1',runId:'run_a',project,runDir:join(base,'state/run_a'),
    config:configSchema.parse({checks:[{id:'tests',command:['node','--test']},{id:'types',command:['npm','run','typecheck']}]}),
    pins:{project,changeName:'add-greeting',targetPath:join(project,'openspec/changes/add-greeting'),root:project,schema:'spec-driven',
      openspecVersion:'1.16.0',procedurePath,procedureDigest:'pinned-procedure-resources',scopeDigest:'scope',workerPolicyDigest:'worker-policy',
      configDigest:'config',projectConfigDigest:'project-config',trackingPaths:[],agents:{verifier:'build',fixer:'build'},
      models:{verifier:model,fixer:model},permissions:{verifier:[],fixer:[]}},
    phase:'verifying',nextRole:'verifier',round:7,createdAt:0,updatedAt:0,activeMs:0,initial:snapshot,stalledCycles:0,workers:[],
    prior:['critical','warning','suggestion'].map((severity,index)=>({id:`F${index+1}`,severity:severity as 'critical'|'warning'|'suggestion',
      category:'correctness',title:`Finding ${index+1}`,explanation:`Requirement mismatch ${index+1}`,
      locations:[`src/greet.ts:${index+1}`],recommendation:`Required action ${index+1}`})),
    taskContext:{state:'all_done',progress:{remaining:0},contextFiles:{tasks:[join(project,'openspec/changes/add-greeting/tasks.md')]},
      context:'Keep named greetings deterministic.',operationGuidance:'Follow the approved task context.'},
  };
  const identity = {schemaVersion:1 as const,runId:state.runId,round:3,changeName:state.pins.changeName,targetPath:state.pins.targetPath};
  state.verifier = {...identity,role:'verifier',verificationComplete:true,outcome:'findings',findings:structuredClone(state.prior),
    checks:[...['completeness','correctness','coherence'].map(id=>({id,description:id,status:'verified' as const,evidence:[`${id} evidence`],reason:''})),
      {id:'integration',description:'Integration behavior',status:'not_verified',evidence:['Existing scenario evidence'],reason:'Needs repaired fixture'},
      {id:'browser',description:'Browser behavior',status:'not_applicable',evidence:[],reason:'Library has no browser interface'}],
    priorFindingResolutions:[{findingId:'F1',status:'unresolved',evidence:['Observed failing scenario'],reason:'Still present'}],
    blockers:[],fullReportMarkdown:'# Complete verifier report'};
  state.fixer = {...identity,role:'fixer',outcome:'completed',
    addressedFindings:state.prior.map(finding=>({findingId:finding.id,evidence:[`${finding.locations[0]} implementation and passing focused test`]})),
    unresolvedFindings:[],changedFiles:['src/greet.ts'],
    checksRun:[{command:['node','--test'],workingDirectory:project,exitCode:0,evidence:['Three tests passed'],summary:'All greeting scenarios passed'}],
    blockers:[],fullReportMarkdown:'# Complete fixer report'};
  return {state,procedure};
}

test('verifier uses one loaded procedure and fixer keeps task context without loading it', async t => {
  const {state,procedure} = await promptState(t);
  const prompt = await workerPrompt(state,'verifier');
  assert.equal(prompt.split(procedure).length-1,1);
  assert(prompt.includes(`Verification procedure: ${state.pins.procedurePath}`));
  assert(prompt.includes(`Resource base directory: ${dirname(state.pins.procedurePath)}`));
  assert(prompt.includes(state.pins.procedureDigest));
  assert(prompt.includes('already loaded'));
  assert(prompt.includes('do not rediscover or reread its entrypoint'));
  assert(prompt.includes('Review committed implementation even when git status is clean'));
  await rm(state.pins.procedurePath);
  const fixing = await workerPrompt(state,'fixer');
  assert(!fixing.includes(procedure));
  assert(!fixing.includes('<openspec-verification-procedure>'));
  assert(fixing.includes(state.pins.procedurePath));
  assert(fixing.includes('Keep named greetings deterministic.'));
  assert.deepEqual(section(fixing,findingMarker),state.prior);
});

test('compact handoffs preserve all issues, checks, and resolution evidence independently of report verbosity', async t => {
  const {state} = await promptState(t);
  const originalVerifying = await workerPrompt(state,'verifier');
  const originalFixing = await workerPrompt(state,'fixer');
  state.verifier!.fullReportMarkdown = 'VERIFIER_MARKDOWN_ONLY '.repeat(150_000);
  state.fixer!.fullReportMarkdown = 'FIXER_MARKDOWN_ONLY '.repeat(150_000);
  const verifying = await workerPrompt(state,'verifier');
  const fixing = await workerPrompt(state,'fixer');
  assert.equal(verifying,originalVerifying);
  assert.equal(fixing,originalFixing);
  for (const prompt of [verifying,fixing]) {
    assert.deepEqual(section(prompt,findingMarker),state.prior);
    assert.deepEqual(section(prompt,verifierMarker).checks,state.verifier!.checks);
    assert.deepEqual(section(prompt,verifierMarker).priorFindingResolutions,state.verifier!.priorFindingResolutions);
    assert(!prompt.includes('MARKDOWN_ONLY'));
    const paths = section(prompt,reportMarker);
    assert.equal(paths.length,2);
    for (const role of ['verifier','fixer']) {
      const saved = paths.find((report: {role: string})=>report.role===role);
      assert.equal(saved.round,3);
      assert.equal(saved.json,join(state.runDir,'rounds/003',`${role}.json`));
      assert.equal(saved.markdown,join(state.runDir,'rounds/003',`${role}.md`));
      assert.equal(saved.raw,join(state.runDir,'rounds/003',`${role}.raw.json`));
      if (role==='verifier') assert.equal(saved.checks,join(state.runDir,'rounds/003/checks.json'));
    }
  }
  const dispositions = section(verifying,fixerMarker);
  assert.deepEqual(dispositions.addressedFindings,state.fixer!.addressedFindings);
  assert.deepEqual(dispositions.changedFiles,state.fixer!.changedFiles);
  assert.deepEqual(dispositions.checksRun,state.fixer!.checksRun);
  assert(!fixing.includes(fixerMarker));
  t.diagnostic(`Saved Markdown: ${Buffer.byteLength(state.verifier!.fullReportMarkdown)+Buffer.byteLength(state.fixer!.fullReportMarkdown)} bytes; verifier prompt: ${Buffer.byteLength(verifying)} bytes; fixer prompt: ${Buffer.byteLength(fixing)} bytes.`);
});

test('large check logs yield bounded excerpts while keeping every command, actual failure status, and workspace evidence', async t => {
  const {state} = await promptState(t);
  const result = (command: string[],exitCode: number,stdout: string,stderr = ''): CommandResult =>
    ({command,workingDirectory:state.project,exitCode,stdout,stderr});
  const noise = (length: number) => `OUTPUT_HEAD\n${'output-only-noise '.repeat(length)}\nOUTPUT_TAIL`;
  const evidence: Evidence = {before:state.initial,after:state.initial,apply:state.taskContext!,
    validation:result(['openspec','validate','add-greeting','--strict'],0,'Strict validation passed'),
    checks:[result(['node','--test'],7,noise(100_000),noise(100_000)),result(['npm','run','typecheck'],0,'Types passed')]};
  const prompt = await workerPrompt(state,'verifier',evidence);
  const projected = section(prompt,evidenceMarker);
  assert.equal(projected.workspace,state.initial.hash);
  assert.equal(projected.checksPath,join(state.runDir,'rounds/007/checks.json'));
  assert.deepEqual(projected.apply,state.taskContext);
  assert.equal(projected.validation.exitCode,0);
  assert.deepEqual(projected.validation.command,evidence.validation.command);
  assert.equal(projected.checks.length,2);
  for (let index=0;index<evidence.checks.length;index++) {
    assert.equal(projected.checks[index].id,state.config.checks[index]!.id);
    assert.deepEqual(projected.checks[index].command,evidence.checks[index]!.command);
    assert.equal(projected.checks[index].workingDirectory,state.project);
    assert.equal(projected.checks[index].exitCode,evidence.checks[index]!.exitCode);
  }
  assert.equal(projected.checks[0].status,'failed');
  assert.equal(projected.checks[1].status,'passed');
  for (const stream of ['stdout','stderr']) {
    const excerpt = projected.checks[0][stream];
    assert(excerpt.text.includes('OUTPUT_HEAD'));
    assert(excerpt.text.includes('OUTPUT_TAIL'));
    assert(excerpt.omittedCharacters>0);
    assert(excerpt.text.length<2600);
  }
  evidence.checks[0]!.stdout = noise(500_000);
  evidence.checks[0]!.stderr = noise(500_000);
  const larger = await workerPrompt(state,'verifier',evidence);
  assert(Buffer.byteLength(larger)<30_000);
  assert(Math.abs(Buffer.byteLength(larger)-Buffer.byteLength(prompt))<100);
  assert.equal(section(larger,evidenceMarker).checks[0].exitCode,7);
  t.diagnostic(`Saved check stdout/stderr: ${Buffer.byteLength(evidence.checks[0]!.stdout)+Buffer.byteLength(evidence.checks[0]!.stderr)} bytes; verifier prompt: ${Buffer.byteLength(larger)} bytes.`);
});
