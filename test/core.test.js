import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LIMITS, validateQuiz, canonicalQuiz, fingerprintQuiz, gradeQuiz, createReceipt, verifyReceipt } from '../src/core.js';

function quiz() {
  return {
    version: 1,
    id: 'literal-values',
    title: 'Exact values',
    description: 'Synthetic test fixture',
    questions: [
      { id: 'q1', prompt: 'Choose the literal shown.', options: [
        { id: 'a', label: 'x < y && ready()', explanation: 'This preserves the comparison and call.' },
        { id: 'b', label: 'x > y', explanation: 'This reverses the comparison.' },
      ], answer: 'a', explanation: 'Choose the exact source expression.' },
      { id: 'q2', prompt: 'Choose the arrow.', options: [
        { id: 'a', label: '→', explanation: 'This points right.' },
        { id: 'b', label: '←', explanation: 'This points left.' },
      ], answer: 'b', explanation: 'The expected arrow points left.' },
      { id: 'q3', prompt: 'Choose the digit.', options: [
        { id: 'a', label: '1', explanation: 'This is a digit.' },
        { id: 'b', label: 'one', explanation: 'This is a word.' },
      ], answer: 'a', explanation: 'The digit is 1.' },
    ],
  };
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, val]) => [key, reverseKeys(val)]));
  return value;
}

test('validation preserves exact option labels, whitespace and Unicode in independent copies', () => {
  const source = quiz();
  source.questions[0].options[0].label = '  <script>🦊\n$Cache: & "x"  ';
  source.description = '';
  const result = validateQuiz(source);
  assert.equal(result.questions[0].options[0].label, source.questions[0].options[0].label);
  result.questions[0].options[0].label = 'changed';
  assert.notEqual(result.questions[0].options[0].label, source.questions[0].options[0].label);
});

test('canonical field order and SHA-256 are independent of object key order', async () => {
  const source = quiz();
  const canonical = canonicalQuiz(source);
  assert.deepEqual(Object.keys(JSON.parse(canonical)), ['version', 'id', 'title', 'description', 'questions']);
  assert.equal(canonicalQuiz(reverseKeys(source)), canonical);
  assert.equal(await fingerprintQuiz(source), createHash('sha256').update(canonical, 'utf8').digest('hex'));
  assert.equal(await fingerprintQuiz(reverseKeys(source)), await fingerprintQuiz(source));
});

test('content changes, exact whitespace and question/option order change the fingerprint', async () => {
  const original = await fingerprintQuiz(quiz());
  for (const mutate of [
    q => { q.title += ' '; }, q => { q.description += ' '; }, q => { q.questions.reverse(); },
    q => { q.questions[0].options.reverse(); }, q => { q.questions[0].answer = 'b'; },
    q => { q.questions[0].explanation += ' '; }, q => { q.questions[0].options[0].label += ' '; },
    q => { q.questions[0].options[0].explanation += ' '; }, q => { q.questions[0].prompt += ' '; },
  ]) {
    const changed = quiz(); mutate(changed);
    assert.notEqual(await fingerprintQuiz(changed), original);
  }
});

test('grading separates correct, incorrect and unanswered with question-specific feedback', () => {
  const answers = { q1: 'a', q2: 'a' };
  const result = gradeQuiz(quiz(), answers);
  assert.deepEqual([result.total, result.correct, result.incorrect, result.unanswered], [3, 1, 1, 1]);
  assert.deepEqual(result.questions.map(q => q.status), ['correct', 'incorrect', 'unanswered']);
  assert.equal(result.questions[1].selectedExplanation, 'This points right.');
  assert.equal(result.questions[1].explanation, 'The expected arrow points left.');
  assert.equal(result.questions[2].selectedOptionId, null);
  assert.equal(result.questions[2].selectedExplanation, null);
  assert.deepEqual(answers, { q1: 'a', q2: 'a' });
});

test('missing and explicit null answers are equivalent; complete answers can all pass', () => {
  assert.deepEqual(gradeQuiz(quiz(), {}), gradeQuiz(quiz(), { q1: null, q2: null, q3: null }));
  const grade = gradeQuiz(quiz(), { q1: 'a', q2: 'b', q3: 'a' });
  assert.equal(grade.correct, 3);
  assert.equal(grade.incorrect + grade.unanswered, 0);
});

test('unknown questions, unknown option identifiers and undefined selections fail', () => {
  for (const answers of [{ unknown: 'a' }, { q1: 'missing' }, { q1: undefined }, { q1: 0 }, [], null]) {
    assert.throws(() => gradeQuiz(quiz(), answers));
  }
});

test('receipts include every question and round-trip through JSON and reordered keys', async () => {
  const receipt = await createReceipt(quiz(), { q1: 'b' });
  assert.deepEqual(receipt.answers, { q1: 'b', q2: null, q3: null });
  assert.equal(receipt.version, 1);
  const verified = await verifyReceipt(reverseKeys(quiz()), reverseKeys(JSON.parse(JSON.stringify(receipt))));
  assert.equal(verified.valid, true);
  assert.deepEqual(verified.grade, receipt.grade);
  assert.equal(verified.quizId, 'literal-values');
});

test('a receipt rejects a different quiz id, changed answer key or modified explanation', async () => {
  const receipt = await createReceipt(quiz(), { q1: 'a' });
  for (const mutate of [q => { q.id = 'other'; }, q => { q.questions[0].answer = 'b'; }, q => { q.questions[0].explanation += ' Clarification.'; }]) {
    const different = quiz(); mutate(different);
    await assert.rejects(verifyReceipt(different, receipt), /does not match/);
  }
});

test('claimed score, answer status, feedback or question order cannot disagree with regrading', async () => {
  for (const mutate of [
    r => { r.grade.correct = 3; }, r => { r.grade.questions[0].status = 'correct'; },
    r => { r.grade.questions[0].selectedExplanation = 'invented'; }, r => { r.grade.questions.reverse(); },
    r => { r.answers.q1 = 'a'; }, r => { r.grade.questions[0].correctOptionId = 'b'; },
  ]) {
    const receipt = await createReceipt(quiz(), { q1: 'b' }); mutate(receipt);
    await assert.rejects(verifyReceipt(quiz(), receipt), /does not match/);
  }
});

test('receipt verification rejects unknown or missing fields at every level', async () => {
  for (const mutate of [
    r => { r.extra = true; }, r => { delete r.quizId; }, r => { r.answers.extra = null; },
    r => { delete r.answers.q3; }, r => { r.grade.extra = true; },
    r => { r.grade.questions[0].extra = true; }, r => { delete r.grade.questions[0].status; },
    r => { r.grade.questions.push(r.grade.questions[0]); },
    r => { r.version = 2; }, r => { r.quizSha256 = 'x'.repeat(64); },
    r => { r.quizSha256 = r.quizSha256.toUpperCase(); },
  ]) {
    const receipt = await createReceipt(quiz(), {}); mutate(receipt);
    await assert.rejects(verifyReceipt(quiz(), receipt));
  }
});

test('a consistently edited receipt remains valid because verification is not identity proof', async () => {
  const before = await createReceipt(quiz(), {});
  const edited = await createReceipt(quiz(), { q1: 'a', q2: 'b', q3: 'a' });
  assert.equal(before.quizSha256, edited.quizSha256);
  assert.equal((await verifyReceipt(quiz(), edited)).grade.correct, 3);
});

test('edits during asynchronous hashing still receive complete receipt validation', async () => {
  const receipt = await createReceipt(quiz(), {});
  const verification = verifyReceipt(quiz(), receipt);
  receipt.quizId = 'changed-during-hash';
  await assert.rejects(verification, /quizId does not match/);
  const extra = await createReceipt(quiz(), {});
  const second = verifyReceipt(quiz(), extra);
  extra.injected = true;
  await assert.rejects(second, /unknown field/);
});

test('duplicate ids, duplicate literal labels and invalid answer references fail', () => {
  for (const mutate of [
    q => { q.questions[1].id = 'q1'; }, q => { q.questions[0].options[1].id = 'a'; },
    q => { q.questions[0].options[1].label = q.questions[0].options[0].label; },
    q => { q.questions[0].answer = 'missing'; }, q => { q.extra = true; },
    q => { q.questions[0].extra = true; }, q => { q.questions[0].options[0].extra = true; },
    q => { delete q.description; }, q => { q.version = '1'; },
  ]) {
    const source = quiz(); mutate(source);
    assert.throws(() => validateQuiz(source));
  }
});

test('identifiers, blank required text and lone surrogates fail without changing valid Unicode', () => {
  for (const identifier of ['__proto__', 'constructor', 'prototype', 'toString', '1start', 'a space', 'é', 'a'.repeat(65)]) {
    const source = quiz(); source.questions[0].id = identifier;
    assert.throws(() => validateQuiz(source));
  }
  for (const value of ['', ' \n\t', '\ud800', '\udc00', 'a\ud800b']) {
    const source = quiz(); source.questions[0].options[0].label = value;
    assert.throws(() => validateQuiz(source));
  }
  const source = quiz(); source.title = '🦊 e\u0301 é';
  assert.equal(validateQuiz(source).title, source.title);
});

test('field length and collection bounds accept boundaries and reject overflow', () => {
  const boundary = quiz();
  boundary.title = 't'.repeat(LIMITS.maxTitleLength);
  boundary.description = 'd'.repeat(LIMITS.maxDescriptionLength);
  boundary.questions[0].prompt = 'p'.repeat(LIMITS.maxPromptLength);
  boundary.questions[0].explanation = 'e'.repeat(LIMITS.maxExplanationLength);
  boundary.questions[0].options[0].label = 'l'.repeat(LIMITS.maxLabelLength);
  assert.doesNotThrow(() => validateQuiz(boundary));
  for (const mutate of [
    q => { q.title += 'x'; }, q => { q.description += 'x'; }, q => { q.questions[0].prompt += 'x'; },
    q => { q.questions[0].explanation += 'x'; }, q => { q.questions[0].options[0].label += 'x'; },
  ]) {
    const bad = structuredClone(boundary); mutate(bad);
    assert.throws(() => validateQuiz(bad), /exceeds/);
  }
  const one = quiz(); one.questions = [one.questions[0]];
  assert.doesNotThrow(() => validateQuiz(one));
  const fifty = quiz(); fifty.questions = Array.from({ length: 50 }, (_, i) => ({ ...structuredClone(one.questions[0]), id: `q${i}` }));
  assert.doesNotThrow(() => validateQuiz(fifty));
  fifty.questions.push({ ...structuredClone(one.questions[0]), id: 'extra' });
  assert.throws(() => validateQuiz(fifty));
  one.questions = []; assert.throws(() => validateQuiz(one));
  const options = quiz(); options.questions[0].options.pop(); assert.throws(() => validateQuiz(options));
  const six = quiz(); six.questions[0].options = Array.from({ length: 6 }, (_, i) => ({ id: i === 0 ? 'a' : `o${i}`, label: String(i), explanation: 'Reason' }));
  assert.doesNotThrow(() => validateQuiz(six));
  six.questions[0].options.push({ id: 'extra', label: 'extra', explanation: 'Reason' });
  assert.throws(() => validateQuiz(six));
});

test('aggregate UTF-8 bound rejects large otherwise-valid content', () => {
  const source = quiz();
  source.questions = Array.from({ length: 50 }, (_, i) => ({ ...structuredClone(source.questions[0]), id: `q${i}`, prompt: '界'.repeat(4000) }));
  assert.throws(() => validateQuiz(source), /UTF-8 bytes/);
});

test('accessors, exotic objects, sparse arrays and prototype-shaped answer keys are rejected', async () => {
  let accessed = false;
  const source = quiz();
  Object.defineProperty(source, 'title', { enumerable: true, get() { accessed = true; return 'Getter'; } });
  assert.throws(() => validateQuiz(source), /data fields/);
  assert.equal(accessed, false);
  assert.throws(() => validateQuiz(Object.assign(Object.create({ inherited: true }), quiz())), /plain data object/);
  const sparse = quiz(); delete sparse.questions[1];
  assert.throws(() => validateQuiz(sparse), /dense/);
  const subclass = quiz();
  class OtherArray extends Array {}
  subclass.questions = new OtherArray(...subclass.questions);
  assert.throws(() => validateQuiz(subclass), /plain data array/);
  const symbol = quiz(); symbol[Symbol('extra')] = true;
  assert.throws(() => validateQuiz(symbol), /unknown/);
  assert.throws(() => gradeQuiz(quiz(), JSON.parse('{"__proto__":"a"}')), /unknown/);
  const receipt = await createReceipt(quiz(), {});
  Object.defineProperty(receipt.grade, 'correct', { enumerable: true, get() { accessed = true; return 0; } });
  await assert.rejects(verifyReceipt(quiz(), receipt), /data fields/);
  assert.equal(accessed, false);
});
