import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifier, fixer, findings } from './fixtures.js';
import { parseReport, needsRepair } from '../src/reports.js';
import { evidenceFailures, type Evidence } from '../src/openspec.js';
import type { Assignment } from '../src/opencode.js';

const a: Assignment = {project:'/tmp/project',runId:'run_a',round:1,role:'verifier',agent:'test',
  sessionId:'ses_a',inputId:'msg_a',model:{providerID:'fake',id:'test'},permissions:[],prompt:''};
const identity = {runId:a.runId,round:a.round,changeName:'add-greeting',targetPath:'/tmp/project/openspec/changes/add-greeting'};
test('accepts evidenced clean report and whole JSON fence',()=>{
  const r=verifier(a);
  assert.equal(parseReport(JSON.stringify(r),'verifier',identity,[]).outcome,'clean');
  assert.equal(parseReport('```json\n'+JSON.stringify(r)+'\n```','verifier',identity,[]).outcome,'clean');
});
test('every severity survives normalization, unknown severity fails',()=>{
  const r=verifier(a,{outcome:'findings',findings});
  const raw=JSON.stringify(r).replace('"suggestion"','"RECOMMENDATION"');
  assert.equal((parseReport(raw,'verifier',identity,[]) as ReturnType<typeof verifier>).findings.length,3);
  assert.throws(()=>parseReport(raw.replace('RECOMMENDATION','info'),'verifier',identity,[]));
});
test('rejects partial, malformed, stale, missing-field, or duplicate reports',()=>{
  const gap={check:'Scenario Coverage',reason:'Tests did not start',repairable:true};
  const {notVerified: _omitted,...withoutGaps}=verifier(a);
  for(const raw of ['', '{}','{} {}','partial '+JSON.stringify(verifier(a)),JSON.stringify(verifier(a,{runId:'other'})),
    JSON.stringify({...verifier(a),schemaVersion:1}),JSON.stringify(withoutGaps),JSON.stringify({...verifier(a),checks:[]}),
    JSON.stringify(verifier(a,{notVerified:[gap,gap]})),JSON.stringify(verifier(a,{findings:[findings[0]!,findings[0]!]}))]) {
    assert.throws(()=>parseReport(raw,'verifier',identity,[]),raw.slice(0,100));
  }
});
test('the controller derives the outcome; a model verdict cannot claim clean',()=>{
  const outcome=(overrides: Parameters<typeof verifier>[1])=>parseReport(JSON.stringify(verifier(a,{outcome:'clean',...overrides})),'verifier',identity,[]).outcome;
  assert.equal(outcome({findings:[findings[2]!]}),'findings');
  assert.equal(outcome({verificationComplete:false}),'findings');
  assert.equal(outcome({notVerified:[{check:'Design Adherence',reason:'Design file unreadable',repairable:true}]}),'findings');
  assert.equal(outcome({notVerified:[{check:'Integration',reason:'Needs production credentials',repairable:false}]}),'blocked');
  assert.equal(outcome({blockers:['missing credentials']}),'blocked');
});
test('missing evidence and failed controller checks become repair work',()=>{
  const r=verifier(a,{notVerified:[{check:'Scenario Coverage',reason:'Need test evidence',repairable:true}]});
  const parsed=parseReport(JSON.stringify(r),'verifier',identity,[]) as ReturnType<typeof verifier>;
  assert.deepEqual(needsRepair(parsed,[]).map(f=>f.id),['check:Scenario Coverage']);
  const clean=parseReport(JSON.stringify(verifier(a)),'verifier',identity,[]) as ReturnType<typeof verifier>;
  const repair=needsRepair(clean,[],['Required check test failed: ["npm","test"]','OpenSpec strict validation failed']);
  assert.deepEqual(repair.map(f=>[f.id,f.severity]),[['evidence:required-check-test-failed-npm-test','critical'],['evidence:openspec-strict-validation-failed','critical']]);
  // A still-unresolved earlier failure keeps its ID without hiding a different new failure.
  const kept=parseReport(JSON.stringify(verifier(a,{priorFindingResolutions:[{findingId:repair[0]!.id,status:'unresolved',evidence:[],reason:'Still failing'}]})),'verifier',identity,[repair[0]!]) as ReturnType<typeof verifier>;
  assert.deepEqual(needsRepair(kept,[repair[0]!],['OpenSpec strict validation failed','Required check test failed: ["npm","test"]']).map(f=>f.id),
    ['evidence:required-check-test-failed-npm-test','evidence:openspec-strict-validation-failed']);
  const incomplete=parseReport(JSON.stringify(verifier(a,{verificationComplete:false})),'verifier',identity,[]) as ReturnType<typeof verifier>;
  assert.equal(incomplete.outcome,'findings');
  assert.deepEqual(needsRepair(incomplete,[]).map(f=>f.id),['verification:incomplete']);
});
test('failing checks sharing a command stay distinct evidence findings',()=>{
  const run=(workingDirectory:string)=>({command:['npm','test'],workingDirectory,exitCode:1,stdout:'',stderr:''});
  const ok={...run('/tmp/project'),exitCode:0};
  const e={validation:ok,apply:{progress:{remaining:0}},checks:[run('/tmp/project/web'),run('/tmp/project/api')]} as unknown as Evidence;
  const clean=parseReport(JSON.stringify(verifier(a)),'verifier',identity,[]) as ReturnType<typeof verifier>;
  assert.deepEqual(needsRepair(clean,[],evidenceFailures(e,['web','api'])).map(f=>f.id),
    ['evidence:required-check-web-failed-npm-test','evidence:required-check-api-failed-npm-test']);
});
test('prior findings cannot disappear, and resolutions need evidence',()=>{
  const r=verifier(a);
  assert.throws(()=>parseReport(JSON.stringify(r),'verifier',identity,findings));
  r.priorFindingResolutions=findings.map(f=>({findingId:f.id,status:'resolved',evidence:['greet.mjs:1 and passing test'],reason:''}));
  assert.doesNotThrow(()=>parseReport(JSON.stringify(r),'verifier',identity,findings));
  r.priorFindingResolutions[0]!.evidence=[];
  assert.throws(()=>parseReport(JSON.stringify(r),'verifier',identity,findings));
});
test('a new finding reusing a resolved prior ID is kept under a distinct ID',()=>{
  const r=verifier(a,{outcome:'findings',findings:[findings[0]!],
    priorFindingResolutions:findings.map(f=>({findingId:f.id,status:'resolved',evidence:['greet.mjs:1 and passing test'],reason:''}))});
  const parsed=parseReport(JSON.stringify(r),'verifier',identity,findings) as ReturnType<typeof verifier>;
  assert.deepEqual(needsRepair(parsed,findings).map(f=>f.id),['F1-r1']);
  const kept=structuredClone(r);kept.priorFindingResolutions[0]!.status='unresolved';kept.priorFindingResolutions[0]!.reason='Still present';
  assert.deepEqual(needsRepair(parseReport(JSON.stringify(kept),'verifier',identity,findings) as ReturnType<typeof verifier>,findings).map(f=>f.id),['F1']);
});
test('fixer must account for every supplied finding and cannot conceal failed checks',()=>{
  const fixed=fixer({...a,prompt:'All prior/unresolved findings requiring disposition (none may be dropped):\n'+JSON.stringify(findings)});
  assert.doesNotThrow(()=>parseReport(JSON.stringify(fixed),'fixer',identity,findings));
  const missing=structuredClone(fixed);missing.addressedFindings.pop();
  assert.throws(()=>parseReport(JSON.stringify(missing),'fixer',identity,findings));
  fixed.checksRun[0]!.exitCode=1;
  assert.throws(()=>parseReport(JSON.stringify(fixed),'fixer',identity,findings));
});
test('a fixer may dispute a finding with evidence instead of blocking the loop',()=>{
  const base=fixer({...a,prompt:'All prior/unresolved findings requiring disposition (none may be dropped):\n'+JSON.stringify(findings)});
  const disputed=structuredClone(base);
  const [first]=disputed.addressedFindings.splice(0,1);
  disputed.disputedFindings=[{findingId:first!.findingId,evidence:['design.md:12 requires exactly three groups']}];
  const parsed=parseReport(JSON.stringify(disputed),'fixer',identity,findings);
  assert.equal(parsed.outcome,'completed');
  const {disputedFindings: _omitted,...legacy}=base;
  assert.deepEqual((parseReport(JSON.stringify(legacy),'fixer',identity,findings) as typeof base).disputedFindings,[]);
  disputed.disputedFindings[0]!.evidence=[];
  assert.throws(()=>parseReport(JSON.stringify(disputed),'fixer',identity,findings));
  const twice=structuredClone(base);twice.disputedFindings=[{findingId:findings[0]!.id,evidence:['duplicate']}];
  assert.throws(()=>parseReport(JSON.stringify(twice),'fixer',identity,findings));
});
