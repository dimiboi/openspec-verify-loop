import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import plugin from '../bb/server.js';

function configure() {
  let select: ((context: {origin: {pluginId: string | null}}) => unknown) | undefined;
  plugin({agents: {configure: fn => { select = fn; }}});
  assert(select, 'the server entry registers a configure callback');
  return (pluginId: string | null) => select!({origin: {pluginId}});
}

test('Workflows workers do not get the skill; every return value carries tools, which bb requires', () => {
  assert.deepEqual(configure()('workflows'), {tools: [], skills: []});
});

test('every other thread keeps the skill', () => {
  const select = configure();
  for (const pluginId of [null, 'side-chat', 'automations']) {
    assert.deepEqual(select(pluginId), {tools: [], skills: ['openspec-verify-loop']}, String(pluginId));
  }
});

test('the selected skill id matches the skill frontmatter, since bb hides an unknown id everywhere', async () => {
  const name = /^---\nname: (\S+)\n/.exec(await readFile('skills/openspec-verify-loop/SKILL.md', 'utf8'))?.[1];
  assert.deepEqual(configure()(null), {tools: [], skills: [name]});
});

test('the skill takes the procedure path from bb skill list, not from a provider skill list that may show a temporary copy', async () => {
  const step = /^1\. [\s\S]*?(?=^2\. )/m.exec(await readFile('skills/openspec-verify-loop/SKILL.md', 'utf8'))?.[0] ?? '';
  assert.match(step, /^1\. Run `bb skill list --environment "\$BB_ENVIRONMENT_ID" --json`/);
  assert.match(step, /Do not use the path from your own skill list/);
});
