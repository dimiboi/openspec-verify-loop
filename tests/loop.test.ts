import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, runScript, type AgentOptions, type LoopResult } from '../src/loop.js';

const source = await loadScript();
const ISSUES = '## Verification Report: add-export\n| Critical | 1 |\nVERDICT: ISSUES';
const CLEAN = '## Verification Report: add-export\nAll checks passed. Ready for archive.\nVERDICT: CLEAN';
const UNVERIFIED = '## Verification Report: add-export\n- **Tests:** Not verified (node_modules missing)\nVERDICT: UNVERIFIED';

type Call = {prompt: string; opts?: AgentOptions};
/** Run the shared script with workers that answer from a queue. */
async function run(replies: string[], args: unknown = {change: 'add-export'}, maxAgentCalls = 100) {
  const calls: Call[] = [];
  const result = await runScript(source, {
    agent: async (prompt, opts) => {
      calls.push({prompt, opts});
      const reply = replies.shift();
      assert(reply !== undefined, 'unexpected worker call');
      return reply;
    },
    phase: () => {}, log: () => {}, args, budget: () => ({maxAgentCalls}),
  }) as LoopResult;
  return {result, calls, roles: calls.map(call => call.opts?.phase)};
}

test('clean on round 1 starts no fixer', async () => {
  const {result, roles} = await run([CLEAN]);
  assert.deepEqual(roles, ['Verify']);
  assert.equal(result.status, 'clean');
  assert.equal(result.rounds, 1);
  assert.equal(result.change, 'add-export');
  assert.equal(result.report, CLEAN);
});

test('a fixer receives the full report, then a fresh verifier runs', async () => {
  const {result, calls, roles} = await run([ISSUES, 'Fixed it.', CLEAN]);
  assert.deepEqual(roles, ['Verify', 'Fix', 'Verify']);
  assert(calls[1]!.prompt.includes(ISSUES));
  assert.equal(result.status, 'clean');
  assert.equal(result.rounds, 2);
});

test('the round limit ends on a verification with no trailing fixer', async () => {
  const {result, roles} = await run([ISSUES, 'fix', ISSUES, 'fix', ISSUES], {change: 'add-export', maxRounds: 3});
  assert.deepEqual(roles, ['Verify', 'Fix', 'Verify', 'Fix', 'Verify']);
  assert.equal(result.status, 'limit');
  assert.equal(result.rounds, 3);
  assert.equal(result.report, ISSUES);
});

test('a small agent-call budget lowers the round limit', async () => {
  const {result, roles} = await run([ISSUES, 'fix', ISSUES], {change: 'add-export'}, 4);
  assert.deepEqual(roles, ['Verify', 'Fix', 'Verify']);
  assert.equal(result.status, 'limit');
});

test('a blocked verifier or fixer ends the run with its reason', async () => {
  const verifier = await run(['Cannot start.\nVERDICT: BLOCKED missing credentials for the payments sandbox']);
  assert.equal(verifier.result.status, 'blocked');
  assert.equal(verifier.result.reason, 'missing credentials for the payments sandbox');
  const fixer = await run([ISSUES, 'Need a decision.\nVERDICT: BLOCKED requirement conflict']);
  assert.deepEqual(fixer.roles, ['Verify', 'Fix']);
  assert.equal(fixer.result.status, 'blocked');
  assert.equal(fixer.result.reason, 'requirement conflict');
});

test('a clean verdict contradicted by the report counts as issues', async () => {
  for (const report of ['## Verification Report: add-export\n2 warning(s)\nVERDICT: CLEAN',
    '## Verification Report: add-export\n| Tests | Not verified |\nVERDICT: CLEAN']) {
    const {result, roles} = await run([report], {change: 'add-export', maxRounds: 1});
    assert.deepEqual(roles, ['Verify']);
    assert.equal(result.status, 'limit');
  }
});

test('emphasis around positive severity counts cannot hide contradictions in either verdict', async () => {
  for (const severity of ['critical', 'warning', 'suggestion']) {
    for (const mark of ['*', '**', '_', '__', '`']) {
      for (const count of [`${mark}1${mark} ${severity}`, `1 ${mark}${severity}${mark}`, `${mark}1 ${severity}${mark}`]) {
        for (const heading of ['', '### Final Assessment\n']) {
          for (const verdict of ['CLEAN', 'UNVERIFIED']) {
            const report = `## Verification Report: add-export\n${heading}${count}\nTests: Not verified\nVERDICT: ${verdict}`;
            // CLEAN must also be contradicted by the count alone, independent of skipped checks.
            const input = verdict === 'CLEAN' ? report.replace('Tests: Not verified\n', '') : report;
            assert.equal((await run([input], {maxRounds: 1})).result.status, 'limit', input);
          }
        }
      }
    }
  }
  const report = '## Verification Report: add-export\n### Final Assessment\n1 **warning** to fix.\nVERDICT: CLEAN';
  const {result, roles, calls} = await run([report, 'Fixed.', CLEAN]);
  assert.deepEqual(roles, ['Verify', 'Fix', 'Verify']);
  assert.equal(result.status, 'clean');
  assert(calls[1]!.prompt.includes(report), 'normalization never alters the report sent to the fixer');
});

test('emphasized zero counts and counts outside the Final Assessment stay clean', async () => {
  for (const count of ['**0** warnings', '0 _suggestions_', '`0` critical issues']) {
    const report = `## Verification Report: add-export\n### Final Assessment\n${count}\nVERDICT: CLEAN`;
    assert.equal((await run([report])).result.status, 'clean');
  }
  const report = '## Verification Report: add-export\nCoverage quotes 1 **warning**.\n### Final Assessment\nAll checks passed.\nVERDICT: CLEAN';
  assert.equal((await run([report])).result.status, 'clean');
});

test('only a check marked Not verified blocks clean, not the words quoted in prose', async () => {
  const quoted = '## Verification Report: add-export\nThe clean rule needs no nonzero count or "not verified" (verify-loop.js).\nAll checks passed.\nVERDICT: CLEAN';
  assert.equal((await run([quoted])).result.status, 'clean');
  for (const marked of ['### Not verified\n- Tests: no node_modules', '- **Design Adherence:** Not verified (no design.md)', '**Not verified** (applicable checks):\n- tests']) {
    const {result} = await run([`## Verification Report: add-export\n${marked}\nVERDICT: CLEAN`], {change: 'add-export', maxRounds: 1});
    assert.equal(result.status, 'limit', marked);
  }
});

test('a quoted Not verified is not a mark; backticks and quoted counts still are', async () => {
  // The sentence that sent a clean run wfr_edb86a01 to a fixer.
  const quoted = '## Verification Report: add-export\n  - Only Not verified checks remain: the `UNVERIFIED` fixture is now "Tests: Not verified (node_modules missing)".\nAll checks passed.\nVERDICT: CLEAN';
  const clean = await run([quoted]);
  assert.deepEqual([clean.roles, clean.result.status], [['Verify'], 'clean']);
  for (const marked of ['- **Tests:** `Not verified`', 'The report quotes "2 warning(s)".']) {
    const {result} = await run([`## Verification Report: add-export\n${marked}\nVERDICT: CLEAN`], {change: 'add-export', maxRounds: 1});
    assert.equal(result.status, 'limit', marked);
  }
});

test('a Final Assessment decides clean and unverified; quotations in earlier sections do not', async () => {
  // Coverage lines like those that sent clean run wfr_fc7b9c54 to fixers every round.
  const body = '## Verification Report: add-export\n### Correctness\n  - *Quoted count:* `"2 warning(s)"` gives status `limit`.\n  - *Status in backticks:* ``- **Tests:** `Not verified` `` gives status `limit`.\n';
  const passed = await run([body + '### Final Assessment\nAll checks passed. Ready for archive.\n\nVERDICT: CLEAN']);
  assert.deepEqual([passed.roles, passed.result.status], [['Verify'], 'clean']);
  const skipped = '### Final Assessment\nNo critical issues found in the checks that ran. Tests not verified: node_modules missing.\n\n';
  assert.equal((await run([body + skipped + 'VERDICT: CLEAN'], {change: 'add-export', maxRounds: 1})).result.status, 'limit');
  assert.equal((await run([body + skipped + 'VERDICT: UNVERIFIED'])).result.status, 'unverified');
  const warned = '**Final Assessment**: No critical issues. 1 warning(s) to consider. Ready for archive (with noted improvements).\nVERDICT: CLEAN';
  assert.equal((await run(['## Verification Report: add-export\n' + warned], {change: 'add-export', maxRounds: 1})).result.status, 'limit');
});

test('Design Adherence Not applicable for a missing design.md does not block clean', async () => {
  const report = '## Verification Report: add-export\n| Design Adherence | Not applicable (no design.md) |\nNo critical issues, warnings or suggestions.\nVERDICT: CLEAN';
  const {result, roles} = await run([report]);
  assert.deepEqual(roles, ['Verify']);
  assert.equal(result.status, 'clean');
});

test('no issues with checks left Not verified ends unverified without a fixer', async () => {
  const {result, roles} = await run([UNVERIFIED]);
  assert.deepEqual(roles, ['Verify']);
  assert.equal(result.status, 'unverified');
  assert.equal(result.rounds, 1);
  assert.equal(result.report, UNVERIFIED);
  const last = await run([ISSUES, 'fix', UNVERIFIED], {change: 'add-export', maxRounds: 2});
  assert.equal(last.result.status, 'unverified');
});

test('an unverified verdict needs a report with no issues and a Not verified check', async () => {
  for (const report of ['## Verification Report: add-export\n1 warning(s)\n- Design: Not verified\nVERDICT: UNVERIFIED',
    '## Verification Report: add-export\nAll checks passed.\nVERDICT: UNVERIFIED',
    '## Verification Report: add-export\n- Design: Not verified\nVERDICT: ISSUES']) {
    const {result} = await run([report], {change: 'add-export', maxRounds: 1});
    assert.equal(result.status, 'limit', report);
  }
});

test('a given change and store reach every prompt unchanged', async () => {
  const {calls} = await run([ISSUES, 'fix', CLEAN], {change: 'add-export', store: 'team-specs'});
  for (const {prompt} of calls) {
    assert.match(prompt, /change `add-export`/);
    assert.match(prompt, /--store team-specs/);
  }
});

test('the procedure path reaches verifier prompts', async () => {
  const {calls} = await run([CLEAN], {change: 'add-export', procedurePath: '/skills/openspec-verify-change/SKILL.md'});
  assert.match(calls[0]!.prompt, /`\/skills\/openspec-verify-change\/SKILL\.md`/);
});

test('without a given change, later rounds use the change from round 1\'s report title', async () => {
  const {result, calls} = await run([ISSUES, 'fix', CLEAN], {});
  assert.doesNotMatch(calls[0]!.prompt, /change `/);
  assert.match(calls[1]!.prompt, /change `add-export`/);
  assert.match(calls[2]!.prompt, /change `add-export`/);
  assert.equal(result.change, 'add-export');
});

test('a failed worker ends the run with its error and starts no further worker', async () => {
  const calls: string[] = [];
  const failing = runScript(source, {
    agent: async (_prompt, opts) => {
      calls.push(opts?.phase ?? '');
      if (opts?.phase === 'Fix') throw new Error('fixer session failed');
      return ISSUES;
    },
    phase: () => {}, log: () => {}, args: {change: 'add-export'}, budget: () => ({maxAgentCalls: 100}),
  });
  await assert.rejects(failing, /fixer session failed/);
  assert.deepEqual(calls, ['Verify', 'Fix']);
});

test('BLOCKED accepts a colon, no reason, and keeps underscores in the reason', async () => {
  const colon = await run(['Cannot start.\nVERDICT: BLOCKED: requirement conflict']);
  assert.deepEqual([colon.result.status, colon.result.reason], ['blocked', 'requirement conflict']);
  const fixer = await run([ISSUES, 'VERDICT: BLOCKED: requirement conflict']);
  assert.deepEqual([fixer.roles, fixer.result.status, fixer.result.reason], [['Verify', 'Fix'], 'blocked', 'requirement conflict']);
  const underscore = await run(['VERDICT: BLOCKED missing PAYMENTS_API_KEY']);
  assert.equal(underscore.result.reason, 'missing PAYMENTS_API_KEY');
  const list = 'Several changes are active:\n- add-export\n- add-import\nVERDICT: BLOCKED';
  for (const maxRounds of [undefined, 1]) {
    const bare = await run([list], {maxRounds});
    assert.deepEqual([bare.roles, bare.result.status, bare.result.reason, bare.result.report], [['Verify'], 'blocked', 'no reason given', list]);
  }
});

test('emphasis and a trailing period do not hide a verdict', async () => {
  const body = '## Verification Report: add-export\nAll checks passed. Ready for archive.\n';
  for (const line of ['**VERDICT: CLEAN**', '_VERDICT: CLEAN_', 'VERDICT: CLEAN.']) {
    assert.equal((await run([body + line])).result.status, 'clean', line);
  }
});

test('an unrecognized verifier result blocks without a fixer, also on the last round', async () => {
  for (const reply of ['', '## Verification Report: add-export\n| Warning | 1 |\nVerdict: issues', '## Verification Report: add-export\n| Warning | 1 |']) {
    for (const maxRounds of [5, 1]) {
      const {result, roles} = await run([reply], {change: 'add-export', maxRounds});
      assert.deepEqual(roles, ['Verify']);
      assert.equal(result.status, 'blocked');
      assert.match(result.reason, /Unrecognized verifier result/);
      assert.equal(result.report, reply);
    }
  }
});

test('a fixer reply needs no verdict line', async () => {
  const {result, roles} = await run([ISSUES, 'Changed src/export.ts and its test.', CLEAN]);
  assert.deepEqual(roles, ['Verify', 'Fix', 'Verify']);
  assert.equal(result.status, 'clean');
});

test('without a change, the verifier is told to block and list the active changes', async () => {
  const {calls} = await run([CLEAN], {});
  assert.match(calls[0]!.prompt, /if several changes are active, end with `VERDICT: BLOCKED` and list them/);
});

test('a report without a title blocks before any fixer when no change is given', async () => {
  const {result, roles} = await run(['| Critical | 1 |\nVERDICT: ISSUES'], {});
  assert.deepEqual(roles, ['Verify']);
  assert.equal(result.status, 'blocked');
  assert.equal(result.change, null);
});

test('worker rules: only verifiers are forbidden to edit; every prompt carries the shared rules', async () => {
  const {calls} = await run([ISSUES, 'fix', CLEAN]);
  for (const {prompt, opts} of calls) {
    assert.equal(/Do not edit, create or delete files in the checkout, including through the shell/.test(prompt), opts?.phase === 'Verify');
    assert.equal(/Temporary files outside it, such as under `\$TMPDIR` or `\/tmp`, are allowed/.test(prompt), opts?.phase === 'Verify');
    assert.equal(/counts as verified when the repository records its date, run and outcome/.test(prompt), opts?.phase === 'Verify');
    assert.equal(/A later edit that leaves that behaviour unchanged, even in the same file, does not make the record stale/.test(prompt), opts?.phase === 'Verify');
    assert.equal(/VERDICT: UNVERIFIED/.test(prompt), opts?.phase === 'Verify');
    assert.equal(/no `design.md`, mark Design Adherence \*\*Not applicable\*\*, not Not verified/.test(prompt), opts?.phase === 'Verify');
    assert.equal(/do not create optional or intentionally omitted artifacts/.test(prompt), opts?.phase === 'Fix');
    assert.doesNotMatch(prompt, /every check it could not verify/);
    assert.match(prompt, /real exit code/);
    assert.match(prompt, /Do not commit, push, merge, deploy, sync specs or archive/);
    assert.match(prompt, /Do not ask the user questions/);
    assert.match(prompt, /Do this task yourself\. Do not use a verify-loop skill .*, do not start or stop loops or workflows, and do not delegate to other agents/);
    assert.match(prompt, /VERDICT: BLOCKED <reason>/);
  }
});

test('the loader rejects clock, randomness and process access like the workflow sandbox', async () => {
  const host = {agent: async () => '', phase: () => {}, log: () => {}, args: {}, budget: () => ({maxAgentCalls: 1})};
  const meta = 'export const meta = {name: "probe", description: "probe"};\n';
  await assert.rejects(runScript(`${meta}return Date.now();`, host), TypeError);
  await assert.rejects(runScript(`${meta}return Math.random();`, host), TypeError);
  await assert.rejects(runScript(`${meta}return process.pid;`, host), TypeError);
  assert.equal(await runScript(`${meta}return [meta.name, Math.max(1, 2), await agent("x")];`, host).then(JSON.stringify), '["probe",2,""]');
  assert.throws(() => runScript('const x = 1;', host), /export const meta/);
});

test('invalid round limits reject before starting a worker', async () => {
  for (const maxRounds of [0, -1, 1.5, NaN, Infinity, '2', null]) {
    let calls = 0;
    await assert.rejects(runScript(source, {
      agent: async () => {calls++; return CLEAN;}, phase: () => {}, log: () => {},
      args: {maxRounds}, budget: () => ({maxAgentCalls: 100}),
    }), /maxRounds must be a positive integer/);
    assert.equal(calls, 0);
  }
});
