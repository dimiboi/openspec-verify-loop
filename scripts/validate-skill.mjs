import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
const root = 'skills/openspec-verify-loop';
const skill = await readFile(`${root}/SKILL.md`,'utf8');
assert.match(skill,/^---\nname: openspec-verify-loop\ndescription: .+\n/);
for(const path of ['LICENSE','references/third-party-licenses.txt','scripts/controller.mjs','references/report-contract.md','templates/verify-loop.md',
  'templates/openspec-loop-verifier.md','templates/openspec-loop-fixer.md']) assert((await stat(`${root}/${path}`)).size>0);
assert(!/TODO|TBD|\{\{/.test(skill));
console.log('Skill entrypoint and bundled resources validated.');
