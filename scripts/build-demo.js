import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { renderQuiz } from '../src/compiler.js';
import { parseJson } from '../src/parse-json.js';
const root = new URL('../', import.meta.url);
const quiz = parseJson(await readFile(new URL('examples/javascript.json', root), 'utf8'));
await mkdir(new URL('dist/', root), { recursive: true });
const html = await renderQuiz(quiz);
await writeFile(new URL('dist/quizreceipt-demo.html', root), html);
console.log(`Built dist/quizreceipt-demo.html (${Buffer.byteLength(html)} bytes)`);
