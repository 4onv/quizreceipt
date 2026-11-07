import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { renderQuiz } from '../src/compiler.js';
import { parseJson, MAX_JSON_BYTES } from '../src/parse-json.js';

const quiz = JSON.parse(await readFile(new URL('../examples/javascript.json', import.meta.url), 'utf8'));

test('compiler is deterministic and content hashes cover exact inline code', async () => {
  const html = await renderQuiz(quiz);
  assert.equal(html, await renderQuiz(JSON.parse(JSON.stringify(quiz))));
  for (const tag of ['script', 'style']) {
    const payload = html.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))[1];
    assert.ok(html.includes(`'sha256-${createHash('sha256').update(payload).digest('base64')}'`));
  }
  assert.ok(html.includes("connect-src 'none'"));
  assert.equal(html.includes('/* QUIZ_SCRIPT */'), false);
});

test('compiler preserves hostile text as data and keeps one script element', async () => {
  const altered = structuredClone(quiz);
  altered.title = '</script><img src=x onerror=alert(1)> $& $$';
  const html = await renderQuiz(altered);
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.ok(html.includes('\\u003c/script\\u003e'));
  assert.ok(html.includes('$\\u0026 $$'));
});

test('strict JSON accepts escaped keys and prototype-like data without pollution', () => {
  const parsed = parseJson('{"__proto__":{"polluted":true},"escaped\\u0020key":[1,-2.5e2,true,false,null,"x\\n"]}');
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(parsed['escaped key'], [1, -250, true, false, null, 'x\n']);
});

test('duplicate and escaped duplicate keys are rejected at every depth', () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '[{"nested":{"x":1,"x":2}}]']) assert.throws(() => parseJson(text), /Duplicate/);
});

test('malformed, nonfinite, deeply nested and oversized JSON fail clearly', () => {
  for (const text of ['', 'true false', '[1,]', '{"a":1,}', '01', '1e999', '"bad\nstring"', '{"x" 2}']) assert.throws(() => parseJson(text), SyntaxError);
  assert.throws(() => parseJson('['.repeat(26) + '0' + ']'.repeat(26)), /nesting/);
  assert.throws(() => parseJson(' '.repeat(MAX_JSON_BYTES + 1)), /1 MiB/);
});
