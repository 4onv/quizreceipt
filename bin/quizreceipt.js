#!/usr/bin/env node
import { open, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseJson, MAX_JSON_BYTES } from '../src/parse-json.js';
import { validateQuiz, fingerprintQuiz, verifyReceipt } from '../src/core.js';
import { renderQuiz } from '../src/compiler.js';

const help = `QuizReceipt 0.1.0
  quizreceipt build QUIZ.json --out QUIZ.html
  quizreceipt demo --out DEMO.html
  quizreceipt validate QUIZ.json
  quizreceipt verify QUIZ.json RECEIPT.json [--json]

Outputs must be new files. Receipts are editable feedback records; verification
regrades their selections against the exact quiz content.
`;

async function load(path) {
  const handle = await open(path, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Input must be a regular file');
    const bytes = Buffer.alloc(MAX_JSON_BYTES + 1);
    let count = 0;
    while (count < bytes.length) {
      const part = await handle.read(bytes, count, bytes.length - count, null);
      if (!part.bytesRead) break;
      count += part.bytesRead;
    }
    if (count > MAX_JSON_BYTES) throw new Error('Input exceeds 1 MiB');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count)); } catch { throw new Error('Input must be valid UTF-8'); }
    return parseJson(text);
  } finally { await handle.close(); }
}

async function main(args) {
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) { process.stdout.write(help); return; }
  if (args.length === 1 && args[0] === '--version') { console.log('0.1.0'); return; }
  const [command, ...rest] = args;
  if (command === 'build' || command === 'demo') {
    const demo = command === 'demo';
    if (rest.length !== (demo ? 2 : 3) || rest[demo ? 0 : 1] !== '--out') throw new Error('Use build QUIZ.json --out QUIZ.html or demo --out DEMO.html');
    const output = rest[demo ? 1 : 2];
    const quiz = demo ? parseJson(await readFile(new URL('../examples/javascript.json', import.meta.url), 'utf8')) : await load(rest[0]);
    if (!demo && resolve(rest[0]) === resolve(output)) throw new Error('Output must differ from the input quiz');
    const html = await renderQuiz(quiz);
    try { await writeFile(output, html, { flag: 'wx' }); } catch (error) { if (error.code === 'EEXIST') throw new Error('Output already exists; choose a new filename'); throw error; }
    console.log(`Wrote ${output}`);
    return;
  }
  if (command === 'validate' && rest.length === 1) {
    const quiz = validateQuiz(await load(rest[0]));
    console.log(JSON.stringify({ valid: true, quizId: quiz.id, questions: quiz.questions.length, quizSha256: await fingerprintQuiz(quiz) }, null, 2));
    return;
  }
  if (command === 'verify' && (rest.length === 2 || (rest.length === 3 && rest[2] === '--json'))) {
    const quiz = await load(rest[0]);
    const receipt = await load(rest[1]);
    try {
      const result = await verifyReceipt(quiz, receipt);
      if (rest[2] === '--json') console.log(JSON.stringify(result, null, 2));
      else console.log(`Receipt matches quiz ${result.quizId}\n${result.grade.correct}/${result.grade.total} correct, ${result.grade.incorrect} incorrect, ${result.grade.unanswered} unanswered\nSelections were regraded. This is an editable feedback record.`);
    } catch (error) {
      if (rest[2] === '--json') console.log(JSON.stringify({ valid: false, error: error.message }));
      else console.error(`Receipt verification failed: ${error.message}`);
      process.exitCode = 1;
    }
    return;
  }
  throw new Error('Unknown command or arguments. Run quizreceipt --help');
}
main(process.argv.slice(2)).catch(error => {
  console.error(`quizreceipt: ${error.message}`);
  process.exitCode = 2;
});
