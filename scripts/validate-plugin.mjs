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
assert.deepEqual(pkg.pi, {extensions: ['./dist/pi.js'], skills: []});
// shortcut: reads the first entry of a one-line `node: ['x', ...]` matrix; update the pattern if the matrix is reshaped.
const floor = /^\s*node:\s*\[\s*'([^']+)'/m.exec(await readFile('.github/workflows/ci.yml', 'utf8'))?.[1];
assert(floor, 'CI must list a node: matrix');
assert.equal(pkg.engines.node, `>=${floor}`, 'engines.node must match the lowest CI Node version');
for (const name of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai']) {
  assert(!pkg.dependencies[name], `${name} is provided by Pi`);
  assert.equal(pkg.peerDependenciesMeta[name].optional, true);
}
const {default: piPlugin} = await import(pathToFileURL(resolve('dist/pi.js')).href);
assert.equal(typeof piPlugin, 'function');
for (const path of ['dist/index.js', 'dist/pi.js', 'dist/pi-supervisor.js', 'bb/server.ts', 'LICENSE', 'skills/openspec-verify-loop/SKILL.md',
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
