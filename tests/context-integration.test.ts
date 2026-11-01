import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRun } from '../src/controller.js';
import { digest } from '../src/util.js';
import { FakeAdapter, findings, fixture, fixtureConfig, fixer, verifier } from './fixtures.js';

test('large valid reports and check logs stay on disk throughout a complete repair loop', async t => {
  const f = await fixture({broken: true});
  t.after(() => rm(f.base, {recursive: true, force: true}));
  const markdown = '# Detailed report\n' + 'Detailed supporting analysis.\n'.repeat(100_000);
  assert(Buffer.byteLength(markdown) > 2 * 1024 * 1024);
  const adapter = new FakeAdapter(async assignment => {
    assert(Buffer.byteLength(assignment.prompt) < 100_000, 'verbose history/logs inflated worker context');
    if (assignment.role === 'fixer') {
      await writeFile(join(f.project, 'greet.mjs'), 'export function greet(name) { return `Hello, ${name}!`; }\n');
      return {status: 'completed', messageId: 'fix', text: JSON.stringify(fixer(assignment, {fullReportMarkdown: markdown}))};
    }
    const report = assignment.round === 1
      ? verifier(assignment, {outcome: 'findings', findings, fullReportMarkdown: markdown})
      : verifier(assignment, {priorFindingResolutions: findings.map(finding => ({
        findingId: finding.id, status: 'resolved', evidence: ['greet.mjs:1 and current passing tests'], reason: '',
      }))});
    return {status: 'completed', messageId: `verify-${assignment.round}`, text: JSON.stringify(report)};
  });
  const state = await createRun(f.project, fixtureConfig({stateDir: f.stateDir, checks: [{
    id: 'noisy-check', command: [process.execPath, '-e',
      'process.stdout.write("CHECK START\\n" + "x".repeat(3 * 1024 * 1024) + "\\nCHECK END\\n");'],
  }, {id: 'tests', command: [process.execPath, '--test', 'greet.test.mjs']}]}),
  adapter, undefined, {lockRoot: f.lockRoot, pollMs: 1});
  assert.equal(state.phase, 'clean', state.reason ?? 'repair loop did not finish clean');
  assert.deepEqual(adapter.seen.map(assignment => assignment.role), ['verifier', 'fixer', 'verifier']);
  for (const assignment of adapter.seen.slice(1)) {
    for (const finding of findings) assert(assignment.prompt.includes(finding.id));
  }
  for (const round of ['001', '002']) {
    const evidence = JSON.parse(await readFile(join(state.runDir, 'rounds', round, 'checks.json'), 'utf8'));
    assert.equal(evidence.checks[0].exitCode, 0);
    assert(evidence.checks[0].stdout.length > 3 * 1024 * 1024);
    assert(evidence.checks[0].stdout.startsWith('CHECK START\n'));
    assert(evidence.checks[0].stdout.endsWith('\nCHECK END\n'));
    assert.equal(evidence.checks[1].exitCode, round === '001' ? 1 : 0);
  }
  for (const role of ['verifier', 'fixer']) {
    assert.equal(digest(await readFile(join(state.runDir, 'rounds', '001', `${role}.md`), 'utf8')), digest(markdown.trim()));
    const saved = JSON.parse(await readFile(join(state.runDir, 'rounds', '001', `${role}.json`), 'utf8'));
    assert.equal(digest(saved.report.fullReportMarkdown), digest(markdown.trim()));
    const raw = JSON.parse(await readFile(join(state.runDir, 'rounds', '001', `${role}.raw.json`), 'utf8'));
    assert.equal(digest(JSON.parse(raw.text).fullReportMarkdown), digest(markdown));
  }
});
