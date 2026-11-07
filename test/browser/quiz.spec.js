import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { renderQuiz } from '../../src/compiler.js';
import { createReceipt, verifyReceipt } from '../../src/core.js';

const quiz = JSON.parse(await readFile(new URL('../../examples/javascript.json', import.meta.url), 'utf8'));
const demoUrl = new URL('../../dist/quizreceipt-demo.html', import.meta.url).href;
const choice = (page, question, option) => page.locator(`[data-question-id="${question}"] input[value="${option}"]`);

async function receiptFromPage(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#receipt-button').click();
  return JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'));
}

test.beforeEach(async ({ page }) => {
  await page.goto(demoUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#quiz-title')).toHaveText(quiz.title);
});

test('mixed answers show distinct feedback and exported receipt regrades in Node', async ({ page }) => {
  await choice(page, 'nan-equality', 'true').check();
  await choice(page, 'array-membership', 'true').check();
  await page.locator('#check-button').click();
  await expect(page.locator('#grade-summary')).toContainText('1');
  for (const [id, label] of [['nan-equality', 'Correct'], ['array-membership', 'Incorrect'], ['null-type', 'Unanswered']]) {
    await expect(page.locator(`[data-question-id="${id}"]`)).toContainText(label);
  }
  const receipt = await receiptFromPage(page);
  const result = await verifyReceipt(quiz, receipt);
  expect(result.grade).toMatchObject({ total: 3, correct: 1, incorrect: 1, unanswered: 1 });
  await expect(page.locator('[data-question-id="array-membership"]')).toContainText('The array contains red and blue.');
});

test('answer edits invalidate feedback and retry preserves only correct selections', async ({ page }) => {
  await choice(page, 'nan-equality', 'true').check();
  await choice(page, 'array-membership', 'true').check();
  await page.locator('#check-button').click();
  await expect(page.locator('#receipt-button')).toBeEnabled();
  await page.locator('#retry-button').click();
  await expect(choice(page, 'nan-equality', 'true')).toBeChecked();
  await expect(choice(page, 'array-membership', 'true')).not.toBeChecked();
  await expect(page.locator('#receipt-button')).toBeDisabled();
  await choice(page, 'array-membership', 'false').check();
  await choice(page, 'null-type', 'object').check();
  await page.locator('#check-button').click();
  expect((await receiptFromPage(page)).grade.correct).toBe(3);
  await choice(page, 'null-type', 'null').check();
  await expect(page.locator('#receipt-button')).toBeDisabled();
});

test('valid receipt import restores a checked attempt; changed quiz or grade is rejected', async ({ page }) => {
  const receipt = await createReceipt(quiz, { 'nan-equality': 'false', 'null-type': 'object' });
  const upload = async data => page.locator('#receipt-file').setInputFiles({ name: 'attempt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await upload(receipt);
  await expect(choice(page, 'nan-equality', 'false')).toBeChecked();
  await expect(page.locator('#receipt-button')).toBeEnabled();
  await upload({ ...receipt, quizSha256: '0'.repeat(64) });
  await expect(page.locator('#error-message')).toBeVisible();
  await expect(choice(page, 'nan-equality', 'false')).toBeChecked();
  await upload({ ...receipt, grade: { ...receipt.grade, correct: 3 } });
  await expect(page.locator('#error-message')).toBeVisible();
  await upload(receipt);
  const roundtrip = await receiptFromPage(page);
  expect(roundtrip).toEqual(receipt);
});

test('receipt import rejects duplicates, invalid UTF-8 and excessive input', async ({ page }) => {
  for (const buffer of [Buffer.from('{"version":1,"version":1}'), Buffer.from([0xff, 0xfe, 0x80]), Buffer.alloc(1024 * 1024 + 1, 65)]) {
    await page.locator('#receipt-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer });
    await expect(page.locator('#error-message')).toBeVisible();
    await expect(page.locator('#receipt-button')).toBeDisabled();
  }
});

test('quiz text is inert, exact and independent of external requests', async ({ page }, testInfo) => {
  const modified = structuredClone(quiz);
  modified.title = '<img src="https://external.invalid/x" onerror="globalThis.executed=true">';
  modified.questions[0].options[0].label = '</script><script>globalThis.executed=true</script> $& "literal"';
  const output = testInfo.outputPath('hostile-quiz.html');
  await mkdir(new URL('../../test-results/', import.meta.url), { recursive: true });
  await writeFile(output, await renderQuiz(modified));
  const requests = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  const { pathToFileURL } = await import('node:url');
  await page.goto(pathToFileURL(output).href, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#quiz-title')).toHaveText(modified.title);
  await expect(page.locator('[data-question-id="nan-equality"]')).toContainText(modified.questions[0].options[0].label);
  expect(await page.evaluate(() => globalThis.executed)).toBeUndefined();
  expect(await page.locator('img').count()).toBe(0);
  await choice(page, 'nan-equality', 'true').check();
  await page.locator('#check-button').click();
  expect((await verifyReceipt(modified, await receiptFromPage(page))).grade.correct).toBe(1);
  expect(requests).toEqual([]);
});

test('native keyboard controls and mobile layout remain usable', async ({ page }) => {
  await expect(choice(page, 'nan-equality', 'true')).toHaveAccessibleName('true');
  await expect(choice(page, 'nan-equality', 'true')).toHaveAccessibleDescription('');
  await choice(page, 'nan-equality', 'true').focus();
  await page.keyboard.press('ArrowRight');
  await expect(choice(page, 'nan-equality', 'false')).toBeChecked();
  await page.locator('#check-button').click();
  await expect(choice(page, 'nan-equality', 'true')).toHaveAccessibleName('true');
  await expect(choice(page, 'nan-equality', 'true')).toHaveAccessibleDescription(`Correct answer ${quiz.questions[0].options[0].explanation}`);
  await choice(page, 'nan-equality', 'true').check();
  await expect(choice(page, 'nan-equality', 'true')).toHaveAccessibleDescription('');
  await page.setViewportSize({ width: 360, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(361);
  const box = await page.locator('#check-button').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(361);
});
