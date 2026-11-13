import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startArgumentsSchema } from '../src/arguments.js';

test('start arguments preserve optional fields without defaults or coercion', () => {
  assert.deepEqual(startArgumentsSchema.parse({}), {});
  const omitted = {change: undefined, store: undefined, maxRounds: undefined};
  assert.deepEqual(startArgumentsSchema.parse(omitted), omitted);
  for (const change of ['a', '123', 'add-export', 'a1-b2']) {
    assert.deepEqual(startArgumentsSchema.parse({change}), {change});
  }
  for (const store of ['a', 'Team_1.specs-2', '0']) {
    assert.deepEqual(startArgumentsSchema.parse({store}), {store});
  }
  for (const maxRounds of [1, 5, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(startArgumentsSchema.parse({maxRounds}), {maxRounds});
  }
});

test('start arguments reject malformed fields and unknown keys', () => {
  for (const change of ['', 'Bad', 'bad_name', '-bad', 'bad-', 'bad--name', '../bad', 'a b']) {
    assert.equal(startArgumentsSchema.safeParse({change}).success, false, change);
  }
  for (const store of ['', '.bad', '-bad', '_bad', '../bad', 'a/b', 'a b']) {
    assert.equal(startArgumentsSchema.safeParse({store}).success, false, store);
  }
  for (const maxRounds of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '3', '1e2']) {
    assert.equal(startArgumentsSchema.safeParse({maxRounds}).success, false, String(maxRounds));
  }
  assert.equal(startArgumentsSchema.safeParse({bogus: 1}).success, false);
});
