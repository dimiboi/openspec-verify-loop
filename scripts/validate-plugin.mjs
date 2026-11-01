import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(pkg.exports['.'], './dist/index.js');
assert(!pkg.workspaces, 'Prebuilt Git packages must not trigger workspace preparation');
for (const script of ['build', 'prepare', 'prepack', 'preinstall', 'install', 'postinstall']) {
  assert(!pkg.scripts?.[script], `Prebuilt Git packages must not define the ${script} preparation trigger`);
}
for (const path of ['dist/index.js', 'LICENSE', 'skills/openspec-verify-loop/SKILL.md',
  'skills/openspec-verify-loop/references/report-contract.md']) assert((await stat(path)).size > 0, path);
const {default: plugin} = await import(pathToFileURL(resolve(pkg.exports['.'])).href);
assert.equal(plugin.id, 'openspec.verify-loop');
assert.equal(typeof plugin.setup, 'function');
const skill = await readFile('skills/openspec-verify-loop/SKILL.md', 'utf8');
assert.match(skill, /^---\nname: openspec-verify-loop\ndescription: .+\n/);
assert.match(skill, /openspec_verify_loop/);
assert(!/TODO|TBD|\{\{/.test(skill));
console.log('Plugin export and packaged skill resources validated (no OpenCode session started).');
