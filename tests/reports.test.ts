import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifier, fixer, findings } from './fixtures.js';
import { parseReport, needsRepair } from '../src/reports.js';
import type { Assignment } from '../src/opencode.js';

const a: Assignment = {project:'/tmp/project',runId:'run_a',round:1,role:'verifier',agent:'test',
  sessionId:'ses_a',inputId:'msg_a',model:{providerID:'fake',id:'test'},prompt:''};
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
test('rejects partial, malformed, stale, empty, duplicate or contradictory reports',()=>{
  for(const raw of ['', '{}','{} {}','partial '+JSON.stringify(verifier(a)),JSON.stringify(verifier(a,{runId:'other'})),
    JSON.stringify(verifier(a,{findings})), JSON.stringify(verifier(a,{verificationComplete:false})),
    JSON.stringify(verifier(a,{checks:[]})),JSON.stringify(verifier(a,{blockers:['missing credentials']})),
    JSON.stringify(verifier(a,{checks:[...verifier(a).checks,...verifier(a).checks]}))]) {
    assert.throws(()=>parseReport(raw,'verifier',identity,[]),raw.slice(0,100));
  }
});
test('missing evidence becomes repair work; justified not applicable is allowed',()=>{
  const r=verifier(a,{outcome:'findings'});
  r.checks[0]!.status='not_verified';r.checks[0]!.reason='Need task evidence';r.checks[0]!.evidence=[];
  const parsed=parseReport(JSON.stringify(r),'verifier',identity,[]) as ReturnType<typeof verifier>;
  assert.equal(needsRepair(parsed,[])[0]?.id,'check:completeness');
  r.outcome='clean';r.checks[0]!.status='not_applicable';r.checks[0]!.reason='Schema has no task tracking';
  assert.doesNotThrow(()=>parseReport(JSON.stringify(r),'verifier',identity,[]));
});
test('prior findings cannot disappear, and resolutions need evidence',()=>{
  const r=verifier(a);
  assert.throws(()=>parseReport(JSON.stringify(r),'verifier',identity,findings));
  r.priorFindingResolutions=findings.map(f=>({findingId:f.id,status:'resolved',evidence:['greet.mjs:1 and passing test'],reason:''}));
  assert.doesNotThrow(()=>parseReport(JSON.stringify(r),'verifier',identity,findings));
  r.priorFindingResolutions[0]!.evidence=[];
  assert.throws(()=>parseReport(JSON.stringify(r),'verifier',identity,findings));
});
test('fixer must account for every supplied finding and cannot conceal failed checks',()=>{
  const fixed=fixer({...a,prompt:'All prior/unresolved findings requiring disposition (none may be dropped):\n'+JSON.stringify(findings)});
  assert.doesNotThrow(()=>parseReport(JSON.stringify(fixed),'fixer',identity,findings));
  const missing=structuredClone(fixed);missing.addressedFindings.pop();
  assert.throws(()=>parseReport(JSON.stringify(missing),'fixer',identity,findings));
  fixed.checksRun[0]!.exitCode=1;
  assert.throws(()=>parseReport(JSON.stringify(fixed),'fixer',identity,findings));
});
