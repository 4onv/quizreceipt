import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createReceipt } from '../src/core.js';

const bin = fileURLToPath(new URL('../bin/quizreceipt.js', import.meta.url));
const source = fileURLToPath(new URL('../examples/javascript.json', import.meta.url));
const quiz = JSON.parse(await readFile(source, 'utf8'));
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
async function scratch(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'quizreceipt-test-'));
  try { await fn(dir); } finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith('quizreceipt-test-'));
    await rm(dir, { recursive: true, force: true });
  }
}

test('a POSIX quiz FIFO fails without waiting for a writer', { skip: process.platform === 'win32' }, async () => scratch(async dir => {
  const fifo = join(dir, 'quiz.json');
  assert.equal(spawnSync('mkfifo', [fifo], { timeout: 5000 }).status, 0);
  const result = spawnSync(process.execPath, [bin, 'validate', fifo], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /regular file/);
}));

test('validate and build from an arbitrary working directory, without overwrites', async () => scratch(async dir => {
  assert.equal(JSON.parse(run('validate', source).stdout).questions, 3);
  const output = join(dir, 'lesson.html');
  const result = run('build', source, '--out', output);
  assert.equal(result.status, 0, result.stderr);
  assert.ok((await readFile(output, 'utf8')).includes('QUIZ_DATA'));
  assert.equal(run('build', source, '--out', output).status, 2);
  assert.equal(run('build', source, '--out', source).status, 2);
}));

test('receipt CLI regrades mixed answers and detects changed claims and quiz content', async () => scratch(async dir => {
  const path = join(dir, 'attempt.json');
  const receipt = await createReceipt(quiz, { 'nan-equality': 'true', 'array-membership': 'true' });
  await writeFile(path, JSON.stringify(receipt));
  const verified = run('verify', source, path, '--json');
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).grade.correct, 1);
  receipt.grade.correct = 3;
  await writeFile(path, JSON.stringify(receipt));
  assert.equal(run('verify', source, path, '--json').status, 1);
  const changed = { ...quiz, title: quiz.title + ' revised' };
  const changedPath = join(dir, 'changed.json');
  await writeFile(changedPath, JSON.stringify(changed));
  assert.equal(run('verify', changedPath, path).status, 1);
}));

test('invalid UTF-8, duplicates, oversized input and unknown arguments return input errors', async () => scratch(async dir => {
  const path = join(dir, 'bad.json');
  for (const data of [Buffer.from([0xff, 0xfe, 0x80]), '{"version":1,"version":2}', Buffer.alloc(1024 * 1024 + 1, 32)]) {
    await writeFile(path, data);
    const result = run('validate', path);
    assert.equal(result.status, 2);
    assert.equal(result.stderr.includes(' at main ('), false);
  }
  assert.equal(run('validate', source, '--unknown').status, 2);
  assert.equal(run('verify', source).status, 2);
}));

test('demo creates a standalone artifact and help/version work', async () => scratch(async dir => {
  const path = join(dir, 'demo.html');
  assert.equal(run('demo', '--out', path).status, 0);
  assert.ok((await readFile(path, 'utf8')).includes('Synthetic demonstration'));
  assert.equal(run('--version').stdout.trim(), '0.1.1');
  assert.match(run('--help').stdout, /verify QUIZ.json/);
}));
