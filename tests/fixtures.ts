import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { command, OPENCODE_VERSION } from '../src/util.js';
import type { Adapter, Assignment, Catalog, Observation } from '../src/opencode.js';
import type { FixerReport, VerifierReport } from '../src/reports.js';

export async function fixture(options: {realSkill?: boolean; broken?: boolean; root?: string} = {}) {
  const basePath = options.root ?? await mkdtemp(join(tmpdir(), 'openspec-loop-'));
  await mkdir(basePath,{recursive:true});
  const base = await realpath(basePath);
  const project = join(base,'consumer with spaces');
  await mkdir(project,{recursive:true});
  assert.equal((await command(['git','init',project],base)).exitCode,0);
  const configHome=join(base,'fixture-config');
  await mkdir(join(configHome,'openspec'),{recursive:true});
  await writeFile(join(configHome,'openspec/config.json'),JSON.stringify({profile:'custom',workflows:['verify','apply'],delivery:'both',telemetry:{enabled:false}}));
  const init = await command(['openspec','init','--tools','opencode','--profile','custom','--no-animation'],project,120_000,undefined,{XDG_CONFIG_HOME:configHome});
  assert.equal(init.exitCode,0,init.stderr);
  assert.equal((await command(['openspec','new','change','add-greeting'],project)).exitCode,0);
  const target = join(project,'openspec/changes/add-greeting');
  await mkdir(join(target,'specs/greeting'),{recursive:true});
  const docs = {
    'proposal.md': '# Why\n\nExpose a deterministic greeting function.\n\n## What Changes\n\nAdd greet(name) and tests.\n\n## Capabilities\n\n### New Capabilities\n- `greeting`: Return a greeting for a supplied name.\n\n### Modified Capabilities\n\nNone.\n\n## Impact\n\nA new greet.mjs module and greet.test.mjs test.\n',
    'design.md': '## Context\n\nA small JavaScript library.\n\n## Goals / Non-Goals\n\nProvide deterministic greetings. No network or UI.\n\n## Decisions\n\nExport a pure greet(name) function from greet.mjs, returning Hello, followed by the supplied name and an exclamation mark. Use Node built-in tests.\n\n## Risks / Trade-offs\n\nNo input validation is required; callers provide names.\n',
    'tasks.md': '## 1. Implementation\n\n- [x] 1.1 Implement greet(name) as specified.\n- [x] 1.2 Add a test for the Ada greeting.\n',
    'specs/greeting/spec.md': '## ADDED Requirements\n\n### Requirement: Named greeting\n\nThe library SHALL export greet(name) returning exactly `Hello, <name>!` for a supplied name.\n\n#### Scenario: Greet Ada\n\n- **WHEN** greet is called with `Ada`\n- **THEN** it returns exactly `Hello, Ada!`\n',
  };
  for(const [path,content] of Object.entries(docs)) await writeFile(join(target,path),content);
  await writeFile(join(project,'greet.mjs'), `export function greet(name) { return \`${options.broken ? 'Hi' : 'Hello'}, \${name}!\`; }\n`);
  await writeFile(join(project,'greet.test.mjs'),"import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from './greet.mjs';\ntest('greet Ada', () => assert.equal(greet('Ada'), 'Hello, Ada!'));\n");
  if (!options.realSkill) await writeFile(join(project,'.opencode/skills/openspec-verify-change/SKILL.md'),
    '---\nname: openspec-verify-change\ndescription: Verify the named change.\n---\nRead artifacts and compare implementation, tests, and design. Report completeness, correctness, coherence and every finding.\n');
  const check = await command(['openspec','validate','add-greeting','--strict','--no-interactive'],project);
  assert.equal(check.exitCode,0,check.stdout+check.stderr);
  return {base,project,target,stateDir:join(base,'state'),lockRoot:join(base,'locks'),skillDir:resolve('skills/openspec-verify-loop')};
}

export function verifier(a: Assignment, overrides: Partial<VerifierReport> = {}): VerifierReport {
  return {schemaVersion:1,runId:a.runId,round:a.round,changeName:'add-greeting',targetPath:join(a.project,'openspec/changes/add-greeting'),
    role:'verifier',verificationComplete:true,outcome:'clean',findings:[],
    checks:['completeness','correctness','coherence'].map(id=>({id,description:id,status:'verified',evidence:['greet.mjs and passing Node test'],reason:''})),
    priorFindingResolutions:[],blockers:[],fullReportMarkdown:'# Complete verification\nAll three dimensions verified; no findings.',...overrides};
}
export function fixer(a: Assignment, overrides: Partial<FixerReport> = {}): FixerReport {
  const findings = JSON.parse(a.prompt.split('All prior/unresolved findings requiring disposition (none may be dropped):\n')[1]!.split('\n\n')[0]!);
  return {schemaVersion:1,runId:a.runId,round:a.round,changeName:'add-greeting',targetPath:join(a.project,'openspec/changes/add-greeting'),
    role:'fixer',outcome:'completed',addressedFindings:findings.map((f:{id:string})=>({findingId:f.id,evidence:['Updated greet.mjs and ran the Node test']})),
    unresolvedFindings:[],changedFiles:['greet.mjs'],checksRun:[{command:['node','--test','greet.test.mjs'],workingDirectory:a.project,exitCode:0,evidence:['Node test passed'],summary:'Pass'}],
    blockers:[],fullReportMarkdown:'# Fix outcome\nFixed the greeting and verified the test.',...overrides};
}
export const findings = ['critical','warning','suggestion'].map((severity,i)=>({id:`F${i+1}`,severity:severity as 'critical'|'warning'|'suggestion',
  category:'correctness',title:`Greeting finding ${i+1}`,explanation:'Mismatch to greeting requirement',locations:['greet.mjs:1'],recommendation:'Return Hello, Ada!'}));

export class FakeAdapter implements Adapter {
  sessions = new Map<string,Assignment>(); inputs = new Set<string>();
  submissions = 0; creations = 0; interrupts = 0; seen: Assignment[] = [];
  interruptResult = true;
  constructor(public handler: (a: Assignment) => Promise<Observation> | Observation = a=>({status:'completed',text:JSON.stringify(verifier(a)),messageId:'final'})) {}
  async catalog(project: string): Promise<Catalog> {
    const skill = join(project,'.opencode/skills/openspec-verify-change/SKILL.md');
    return {version:OPENCODE_VERSION,defaultModel:{providerID:'fake',id:'test'},
      models:[{id:'test',providerID:'fake',enabled:true,variants:['default']}],
      agents:['verifier','fixer'].map(role=>({id:`openspec-loop-${role}`,name:role,mode:'all',hidden:false,request:{settings:{},headers:{},body:{}},permissions:[]})),
      skills:[{id:skill,name:'openspec-verify-change',path:skill,content:await readFile(skill,'utf8')}]};
  }
  async ensureSession(a: Assignment) { if(!this.sessions.has(a.sessionId)) {this.sessions.set(a.sessionId,a);this.creations++;} }
  async ensurePrompt(a: Assignment, allowSubmission = true) {
    if(!this.inputs.has(a.inputId)) {
      if (!allowSubmission) throw new Error('Unknown admission; refusing to submit');
      this.inputs.add(a.inputId);this.submissions++;this.seen.push(a);
    }
  }
  async observe(a: Assignment) { return this.handler(a); }
  async interrupt() { this.interrupts++; return this.interruptResult; }
}
