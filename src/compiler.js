import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalQuiz } from './core.js';

const read = async name => (await readFile(new URL(name, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');

export async function renderQuiz(quiz) {
  const data = canonicalQuiz(quiz).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const [template, css, parser, core, runner] = await Promise.all(['quiz.html', 'quiz.css', 'parse-json.js', 'core.js', 'runner.js'].map(read));
  const source = [parser, core, `const QUIZ_DATA = ${data};`, runner].map(part => part.replace(/^export /gm, '')).join('\n');
  const js = `\n(() => {\n'use strict';\n${source.replace(/<\/script/gi, '<\\/script')}\n})();\n`;
  const style = `\n${css}\n`;
  const hash = value => `'sha256-${createHash('sha256').update(value).digest('base64')}'`;
  const policy = `default-src 'none'; script-src ${hash(js)}; style-src ${hash(style)}; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; img-src 'none'`;
  if (template.split('/* QUIZ_STYLE */').length !== 2 || template.split('/* QUIZ_SCRIPT */').length !== 2) throw new Error('Invalid quiz template');
  return template.replace('<head>', () => `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`).replace('/* QUIZ_STYLE */', () => style).replace('/* QUIZ_SCRIPT */', () => js);
}
