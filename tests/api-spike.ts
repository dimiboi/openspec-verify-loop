import assert from 'node:assert/strict';
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect, type Assignment } from '../src/opencode.js';
import { newId } from '../src/state.js';
import { command, delay } from '../src/util.js';
import { fixture } from './fixtures.js';

const {project} = await fixture({realSkill:true});
await mkdir(resolve(project, '.opencode/agents'), {recursive:true});
await copyFile('skills/openspec-verify-loop/templates/openspec-loop-verifier.md', resolve(project, '.opencode/agents/openspec-loop-verifier.md'));
const adapter = await connect();
const catalog = await adapter.catalog(project);
assert(catalog.agents.some(a => a.id === 'openspec-loop-verifier' && a.mode === 'all'));
assert(catalog.skills.some(s => s.id === 'openspec-verify-change' || s.name === 'openspec-verify-change'));
const assignment: Assignment = {project, runId: newId('run'), sessionId:newId('ses'), inputId:newId('msg'),
  role:'verifier',round:1,agent:'openspec-loop-verifier',model:{providerID:'lmstudio',id:'recursivesi/flint'},
  prompt:'Load the openspec-verify-change skill with the skill tool. Do not perform verification or change any file. This is an API compatibility probe. Then return exactly {"loaded":true} as your final response.'};
await adapter.ensureSession(assignment);
await adapter.ensureSession(assignment);
await adapter.ensurePrompt(assignment);
await adapter.ensurePrompt(assignment);
console.log(JSON.stringify({session:assignment.sessionId,input:assignment.inputId}));
for(let i=0;i<180;i++) {
  const result = await adapter.observe(assignment);
  if (result.status !== 'running') {
    console.log(JSON.stringify(result));
    assert.equal(result.status,'completed');
    break;
  }
  if(i===179) { await adapter.interrupt(assignment); throw new Error('Spike timed out'); }
  await delay(1000);
}
const messages = await adapter.messages(assignment.sessionId);
assert.equal(messages.filter(m=>m.type==='user').length,1);
// Our recovery path must not re-prompt a delivered input, because the server may restart it.
const before = await adapter.client.session.get({sessionID:assignment.sessionId});
await adapter.ensurePrompt(assignment, false);
await delay(500);
const after = await adapter.client.session.get({sessionID:assignment.sessionId});
assert.equal(after.time.busy, before.time.busy);
assert.equal((await adapter.messages(assignment.sessionId)).filter(m=>m.type==='user').length,1);
console.log('API spike passed: profile, skill, existing-input reconciliation, final-response collection, no duplicate execution.');
