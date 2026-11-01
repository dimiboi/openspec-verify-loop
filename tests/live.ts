// Opt-in live exercise. Uses a separate checkout and the configured model; keeps reports for inspection.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fixture } from './fixtures.js';
import { command } from '../src/util.js';
import { connect } from '../src/opencode.js';

const model=process.env.VERIFY_LOOP_LIVE_MODEL;
if(!model) throw new Error('Set VERIFY_LOOP_LIVE_MODEL=provider/model to opt into live model execution');
await mkdir('.live',{recursive:true});
async function prepare() {
const f=await fixture({realSkill:true,broken:true,root:await mkdtemp(join(tmpdir(),'openspec-live-'))});
await writeFile('.live/latest-live.json',JSON.stringify({project:f.project,stateDir:f.stateDir}));
const installed=join(f.project,'.opencode/skills/openspec-verify-loop');
await cp(f.skillDir,installed,{recursive:true});
const executable=join(installed,'scripts/controller.mjs');
for(let i=0;i<2;i++) {
  const result=await command([process.execPath,executable,'setup','--project',f.project],f.project);
  assert.equal(result.exitCode,0,result.stdout+result.stderr);
  if(i===1) assert(JSON.parse(result.stdout).files.every((file:{status:string})=>file.status==='unchanged'));
}
// Test-only permission rules allow the fixture's check command. No blanket auto-approval.
const profile=join(f.project,'.opencode/agents/openspec-loop-verifier.md');
let verifier=await readFile(profile,'utf8');
verifier=verifier.replace('permissions:\n','permissions:\n  - action: shell\n    resource: "node --test greet.test.mjs"\n    effect: allow\n');
// Specific check rule must follow the broad shell ask rule to win.
verifier=verifier.replace('  - action: shell\n    resource: "node --test greet.test.mjs"\n    effect: allow\n','');
verifier=verifier.replace('\n---\n\nPerform','\n  - action: shell\n    resource: "node --test greet.test.mjs"\n    effect: allow\n  - action: shell\n    resource: "find *"\n    effect: allow\n  - action: shell\n    resource: "sort"\n    effect: allow\n---\n\nPerform');
await writeFile(profile,verifier);
await writeFile(join(f.project,'.opencode/openspec-verify-loop.json'),JSON.stringify({
  verifierModel:model,fixerModel:model,stateDir:f.stateDir,maxRounds:4,maxMinutes:20,
  checks:[{id:'tests',command:['node','--test','greet.test.mjs']}],
},null,2));
// Establish a realistic implementation baseline; only the deliberate defect remains in the diff.
await writeFile(join(f.project,'greet.mjs'),'export function greet(name) { return `Hello, ${name}!`; }\n');
assert.equal((await command(['git','add','--all'],f.project)).exitCode,0);
assert.equal((await command(['git','-c','user.name=Loop fixture','-c','user.email=fixture@example.invalid','commit','-m','Fixture baseline'],f.project)).exitCode,0);
await writeFile(join(f.project,'greet.mjs'),'export function greet(name) { return `Hi, ${name}!`; }\n');
return {f,executable};
}
const resumeProject=process.env.VERIFY_LOOP_LIVE_PROJECT;
const {f,executable}=resumeProject ? await (async()=>{
  const config=JSON.parse(await readFile(join(resumeProject,'.opencode/openspec-verify-loop.json'),'utf8'));
  assert.equal(config.verifierModel,model);
  return {f:{project:resumeProject,stateDir:config.stateDir as string},executable:resolve('skills/openspec-verify-loop/scripts/controller.mjs')};
})() : await prepare();
await writeFile('.live/latest-live.json',JSON.stringify({project:f.project,stateDir:f.stateDir}));
const discovery=await connect();
await discovery.catalog(f.project);
assert((await discovery.client.command.list({location:{directory:f.project}})).data.some(c=>c.name==='verify-loop'));
console.log(JSON.stringify({event:'live_fixture',project:f.project,stateDir:f.stateDir,model}));
let final: any = process.env.VERIFY_LOOP_LIVE_RUN ? {runId:process.env.VERIFY_LOOP_LIVE_RUN} : undefined;
for(let attempt=0;attempt<20;attempt++) {
  const args=final?['resume','--project',f.project,'--run',final.runId]:['run','--project',f.project];
  const child=spawn(process.execPath,[executable,...args],{cwd:f.project,stdio:['ignore','pipe','inherit']});
  let output='';child.stdout.on('data',chunk=>{output+=chunk.toString();process.stdout.write(chunk);});
  const code=await new Promise<number|null>((res,rej)=>{child.on('error',rej);child.on('exit',res);});
  final=JSON.parse(output.trim().split('\n').at(-1)!);
  if(final.outcome!=='awaiting_input') {assert.equal(code,0,`Live run did not finish clean. Inspect ${f.stateDir}`);break;}
  // Test harness acts as the fixture's user for a narrow, predeclared set of inspection/check requests.
  // The product controller never replies to permissions. Unknown requests fail this exercise.
  const adapter=await connect();
  const requests=await adapter.client.permission.list({sessionID:final.pending.sessionId});
  assert(requests.length,'Live test does not answer model questions');
  for(const request of requests) {
    assert.equal(request.action,'shell');
    for(const resource of request.resources) {
      const inspection=resource.replaceAll('2>/dev/null','').replaceAll('2>&1','').trim();
      const fixtureRuntimeCheck = `node -e "import('./greet.mjs').then(m=>{console.log(JSON.stringify(m.greet('Ada')),JSON.stringify(m.greet('Grace')),JSON.stringify(m.greet('')));})"`;
      if(inspection===fixtureRuntimeCheck || inspection==='echo "=== $f ==="')continue;
      assert(!/[`<>;]|\$\(|-delete\b|-exec\b|--output/.test(inspection),`Unsupported test request: ${resource}`);
      assert(/^(ls|find|sort|cat|head|wc|grep|rg|pwd)(\s|$)/.test(inspection) ||
        /^git (status|diff|log|show|ls-files|ls-tree|grep|rev-parse)(\s|$)/.test(inspection) ||
        /^openspec (list|status|show|instructions|validate)(\s|$)/.test(inspection) ||
        /^echo (["'])[-A-Za-z0-9 ._/:=]+\1$/.test(inspection) ||
        ['node --test','node --test greet.test.mjs','echo "EXIT=$?"'].includes(inspection),`Unsupported test request: ${resource}`);
    }
    await adapter.client.permission.reply({sessionID:final.pending.sessionId,requestID:request.id,decision:'once'});
    console.log(JSON.stringify({event:'test_user_allowed_inspection',requestId:request.id,resources:request.resources}));
  }
}
assert.equal(final.outcome,'clean');
assert(final.workers.some((w:{role:string})=>w.role==='fixer'));
assert(final.workers.filter((w:{role:string})=>w.role==='verifier').length>=2);
assert.equal(new Set(final.workers.map((w:{sessionId:string})=>w.sessionId)).size,final.workers.length);
assert.equal((await command(['node','--test','greet.test.mjs'],f.project)).exitCode,0);
assert.match(await readFile(join(f.project,'greet.mjs'),'utf8'),/Hello/);
console.log(JSON.stringify({event:'live_passed',runDir:final.runDir,workers:final.workers.length}));
