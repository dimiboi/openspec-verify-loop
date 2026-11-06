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
for (const field of ['name', 'description', 'branding', 'server']) assert(pkg.bb?.[field], `bb manifest needs ${field}`);
assert.equal(pkg.bb.server, './bb/server.ts');
for (const path of ['dist/index.js', 'bb/server.ts', 'LICENSE', 'skills/openspec-verify-loop/SKILL.md',
  'skills/openspec-verify-loop/verify-loop.js', 'opencode/SKILL.md']) assert((await stat(path)).size > 0, path);
const {default: plugin} = await import(pathToFileURL(resolve(pkg.exports['.'])).href);
assert.equal(plugin.id, 'openspec.verify-loop');
assert.equal(typeof plugin.setup, 'function');
const frontmatter = /^---\nname: openspec-verify-loop\ndescription: .+\n/;
const bbSkill = await readFile('skills/openspec-verify-loop/SKILL.md', 'utf8');
assert.match(bbSkill, frontmatter);
assert.match(bbSkill, /bb workflows run --script/);
assert.match(bbSkill, /`auto` or `full`/);
assert.match(bbSkill, /verify workflow must\s+be installed and stop/);
assert.match(bbSkill, /If the command fails, report its error and stop\. Do not retry it/);
for (const text of ['--store', '--max-rounds', 'bb workflows status', 'bb workflows stop']) assert(bbSkill.includes(text), `bb skill must mention ${text}`);
const openCodeSkill = await readFile('opencode/SKILL.md', 'utf8');
assert.match(openCodeSkill, frontmatter);
assert.match(openCodeSkill, /openspec_verify_loop/);
for (const skill of [bbSkill, openCodeSkill]) assert(!/TODO|TBD|\{\{/.test(skill));
console.log('Plugin exports, bb manifest and packaged skills validated (no OpenCode session started).');
