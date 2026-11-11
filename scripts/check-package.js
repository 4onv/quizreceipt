import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Use npm run check:package -- ARCHIVE');
const archive = resolve(process.argv[2] || '4onv-quizreceipt-0.1.1.tgz');
const scratch = await mkdtemp(join(tmpdir(), 'quizreceipt-package-'));
try {
  await writeFile(join(scratch, 'package.json'), '{"private":true,"type":"module"}');
  execFileSync(process.execPath, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archive], { cwd: scratch, stdio: 'pipe' });
  const installed = join(scratch, 'node_modules/@4onv/quizreceipt');
  const bin = join(installed, 'bin/quizreceipt.js');
  const run = args => execFileSync(process.execPath, [bin, ...args], { cwd: scratch, encoding: 'utf8' });
  if (run(['--version']).trim() !== '0.1.1') throw new Error('Installed version mismatch');
  run(['demo', '--out', 'demo.html']);
  const info = JSON.parse(run(['validate', join(installed, 'examples/javascript.json')]));
  if (info.questions !== 3) throw new Error('Installed fixture mismatch');
  await writeFile(join(scratch, 'check.mjs'), `import { readFile, writeFile } from 'node:fs/promises';\nimport { createReceipt, verifyReceipt } from '@4onv/quizreceipt';\nconst quiz=JSON.parse(await readFile('./node_modules/@4onv/quizreceipt/examples/javascript.json','utf8'));\nconst receipt=await createReceipt(quiz,{'nan-equality':'true'});\nif(!(await verifyReceipt(quiz,receipt)).valid) throw new Error('API check failed');\nawait writeFile('receipt.json',JSON.stringify(receipt));\n`);
  execFileSync(process.execPath, ['check.mjs'], { cwd: scratch, stdio: 'inherit' });
  const verified = JSON.parse(run(['verify', join(installed, 'examples/javascript.json'), 'receipt.json', '--json']));
  if (verified.grade.correct !== 1 || verified.grade.unanswered !== 2) throw new Error('Installed receipt verification mismatch');
  if (!(await readFile(join(scratch, 'demo.html'), 'utf8')).includes('Content-Security-Policy')) throw new Error('Installed compiler output missing');
  console.log('Offline installation, installed CLI/API, demo generation and receipt regrading passed');
} finally {
  if (dirname(resolve(scratch)) !== resolve(tmpdir()) || !basename(scratch).startsWith('quizreceipt-package-')) throw new Error('Unexpected cleanup path');
  await rm(scratch, { recursive: true, force: true });
}
