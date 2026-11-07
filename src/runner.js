// This module is embedded after the core by the standalone HTML compiler.
const qrById = id => document.getElementById(id);
let qrQuiz;
let qrGrade = null;
let qrReceipt = null;
let qrRevision = 0;
let qrBusy = false;
let qrReceiptCapability = true;
let qrCapabilityError = '';
const qrQuestionNodes = new Map();

function qrElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function qrError(message) {
  const visibleMessage = message || qrCapabilityError;
  qrById('error-message').textContent = visibleMessage;
  qrById('error-message').hidden = !visibleMessage;
}

function qrSyncButtons() {
  qrById('receipt-button').disabled = qrBusy || !qrReceipt || !qrReceiptCapability;
  qrById('retry-button').disabled = qrBusy || !qrGrade || qrGrade.correct === qrGrade.total;
  qrById('check-button').disabled = qrBusy || !qrQuiz;
}

function qrReadAnswers() {
  return Object.fromEntries(qrQuiz.questions.map(question => {
    const node = qrQuestionNodes.get(question.id);
    const selected = [...node.options.entries()].find(([, value]) => value.input.checked);
    return [question.id, selected?.[0] ?? null];
  }));
}

function qrUpdateProgress() {
  const answered = Object.values(qrReadAnswers()).filter(value => value !== null).length;
  qrById('answered-count').textContent = `${answered} of ${qrQuiz.questions.length} answered`;
  qrById('answered-progress').max = qrQuiz.questions.length;
  qrById('answered-progress').value = answered;
}

function qrClearGrade(message = '') {
  qrRevision++;
  qrBusy = false;
  qrGrade = null;
  qrReceipt = null;
  qrById('grade-heading').textContent = 'Ready when you are';
  qrById('grade-description').textContent = 'Choose your answers, then check them for question-by-question feedback.';
  qrById('grade-counts').hidden = true;
  qrById('grade-summary').classList.remove('qr-graded');
  for (const node of qrQuestionNodes.values()) {
    node.fieldset.classList.remove('qr-is-correct', 'qr-is-incorrect', 'qr-is-unanswered');
    node.feedback.hidden = true;
    node.feedback.replaceChildren();
    for (const option of node.options.values()) {
      option.label.classList.remove('qr-option-correct', 'qr-option-selected-wrong');
      option.explanation.hidden = true;
      option.input.removeAttribute('aria-describedby');
      option.result.textContent = '';
      option.result.hidden = true;
    }
  }
  qrError('');
  qrById('status-message').textContent = message;
  qrUpdateProgress();
  qrSyncButtons();
}

function qrRenderQuestions() {
  const fragment = document.createDocumentFragment();
  qrQuiz.questions.forEach((question, questionIndex) => {
    const fieldset = qrElement('fieldset', 'qr-card qr-question');
    fieldset.dataset.questionId = question.id;
    fieldset.id = `qr-question-${questionIndex}`;
    const legend = qrElement('legend', 'qr-question-legend');
    legend.append(qrElement('span', 'qr-question-number', `Question ${questionIndex + 1}`), qrElement('span', 'qr-prompt', question.prompt));
    fieldset.append(legend);
    const options = new Map();
    question.options.forEach((option, optionIndex) => {
      const label = qrElement('label', 'qr-option');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = question.id;
      input.value = option.id;
      input.id = `qr-option-${questionIndex}-${optionIndex}`;
      const body = qrElement('span', 'qr-option-body');
      const title = qrElement('span', 'qr-option-title');
      const optionText = qrElement('span', 'qr-option-text', option.label);
      optionText.id = `qr-label-${questionIndex}-${optionIndex}`;
      input.setAttribute('aria-labelledby', optionText.id);
      const result = qrElement('span', 'qr-option-result');
      result.id = `qr-option-result-${questionIndex}-${optionIndex}`;
      result.hidden = true;
      title.append(optionText, result);
      const explanation = qrElement('span', 'qr-option-explanation', option.explanation);
      explanation.id = `qr-explanation-${questionIndex}-${optionIndex}`;
      explanation.hidden = true;
      body.append(title, explanation);
      label.append(input, body);
      fieldset.append(label);
      options.set(option.id, { input, label, result, explanation });
    });
    const feedback = qrElement('div', 'qr-feedback');
    feedback.id = `qr-feedback-${questionIndex}`;
    feedback.hidden = true;
    fieldset.append(feedback);
    qrQuestionNodes.set(question.id, { fieldset, feedback, options });
    fragment.append(fieldset);
  });
  qrById('question-list').replaceChildren(fragment);
}

function qrShowGrade(grade) {
  qrGrade = grade;
  qrById('grade-heading').textContent = `${grade.correct} of ${grade.total} correct`;
  qrById('grade-description').textContent = grade.correct === grade.total
    ? 'Every answer is correct. Review the explanations to see why.'
    : 'Review the feedback below each question, then try the ones you missed.';
  qrById('correct-count').textContent = grade.correct;
  qrById('incorrect-count').textContent = grade.incorrect;
  qrById('unanswered-count').textContent = grade.unanswered;
  qrById('grade-counts').hidden = false;
  qrById('grade-summary').classList.add('qr-graded');
  for (const result of grade.questions) {
    const question = qrQuiz.questions.find(item => item.id === result.questionId);
    const node = qrQuestionNodes.get(result.questionId);
    node.fieldset.classList.remove('qr-is-correct', 'qr-is-incorrect', 'qr-is-unanswered');
    node.fieldset.classList.add(`qr-is-${result.status}`);
    node.feedback.replaceChildren();
    const heading = qrElement('h3', 'qr-feedback-heading', { correct: 'Correct', incorrect: 'Incorrect', unanswered: 'Unanswered' }[result.status]);
    const correctOption = question.options.find(option => option.id === result.correctOptionId);
    if (result.status !== 'correct') {
      node.feedback.append(heading, qrElement('p', 'qr-correct-answer', `Correct answer: ${correctOption.label}`));
    } else {
      node.feedback.append(heading);
    }
    node.feedback.append(qrElement('p', 'qr-question-explanation', result.explanation));
    node.feedback.hidden = false;
    for (const [optionId, option] of node.options) {
      const isCorrect = optionId === result.correctOptionId;
      const isSelected = optionId === result.selectedOptionId;
      option.label.classList.toggle('qr-option-correct', isCorrect);
      option.label.classList.toggle('qr-option-selected-wrong', isSelected && !isCorrect);
      option.result.textContent = isCorrect ? (isSelected ? 'Your choice · Correct' : 'Correct answer') : isSelected ? 'Your choice · Incorrect' : '';
      option.result.hidden = !option.result.textContent;
      option.explanation.hidden = false;
      option.input.setAttribute('aria-describedby', `${option.result.id} ${option.explanation.id}`);
    }
  }
  qrUpdateProgress();
  qrSyncButtons();
}

async function qrCheckAnswers(event) {
  event.preventDefault();
  if (qrBusy || !qrQuiz) return;
  qrError('');
  const revision = ++qrRevision;
  qrReceipt = null;
  const answers = qrReadAnswers();
  try {
    qrShowGrade(gradeQuiz(qrQuiz, answers));
    qrById('grade-summary').focus({ preventScroll: true });
    qrById('status-message').textContent = `Checked ${qrGrade.total} questions. ${qrGrade.correct} correct, ${qrGrade.incorrect} incorrect, ${qrGrade.unanswered} unanswered.`;
    if (!qrReceiptCapability) return;
    qrBusy = true;
    qrSyncButtons();
    const receipt = await createReceipt(qrQuiz, answers);
    if (revision !== qrRevision) return;
    qrReceipt = receipt;
  } catch (error) {
    if (revision !== qrRevision) return;
    qrError(error instanceof Error ? error.message : 'The answers could not be checked.');
  } finally {
    if (revision === qrRevision) {
      qrBusy = false;
      qrSyncButtons();
    }
  }
}

function qrRestoreAnswers(answers) {
  for (const [questionId, node] of qrQuestionNodes) {
    for (const [optionId, option] of node.options) option.input.checked = answers[questionId] === optionId;
  }
}

function qrRetryMissed() {
  if (!qrGrade) return;
  const missed = qrGrade.questions.filter(question => question.status !== 'correct');
  const answers = qrReadAnswers();
  for (const item of missed) answers[item.questionId] = null;
  qrRestoreAnswers(answers);
  qrClearGrade(`Ready to retry ${missed.length} missed question${missed.length === 1 ? '' : 's'}. Correct answers were kept.`);
  const first = qrQuestionNodes.get(missed[0]?.questionId);
  first?.options.values().next().value?.input.focus();
}

async function qrImportReceipt(event) {
  const file = event.target.files[0];
  if (!file) return;
  const revision = ++qrRevision;
  qrBusy = true;
  qrError('');
  qrById('status-message').textContent = 'Checking the imported receipt against this quiz…';
  qrSyncButtons();
  try {
    if (file.size > MAX_JSON_BYTES) throw new RangeError('The receipt exceeds the 1 MiB limit.');
    const bytes = await file.arrayBuffer();
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new TypeError('The receipt must contain valid UTF-8 text.');
    }
    const imported = parseJson(text);
    const verified = await verifyReceipt(qrQuiz, imported);
    if (revision !== qrRevision) return;
    qrRestoreAnswers(imported.answers);
    qrReceipt = imported;
    qrShowGrade(verified.grade);
    qrById('status-message').textContent = 'Receipt verified. Answers restored and grading checked against this quiz.';
    qrById('grade-summary').focus({ preventScroll: true });
  } catch (error) {
    if (revision !== qrRevision) return;
    qrError(error instanceof Error ? error.message : 'This receipt could not be verified.');
    qrById('status-message').textContent = 'Import failed. Your current answers are preserved.';
  } finally {
    event.target.value = '';
    if (revision === qrRevision) {
      qrBusy = false;
      qrSyncButtons();
    }
  }
}

function qrDownloadReceipt() {
  if (!qrReceipt || qrBusy) return;
  const blob = new Blob([JSON.stringify(qrReceipt, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${qrQuiz.id}-receipt.json`;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  qrById('status-message').textContent = 'Receipt download prepared. It includes your selected answers and results.';
}

async function qrStart() {
  try {
    qrQuiz = validateQuiz(QUIZ_DATA);
    document.title = `${qrQuiz.title} · QuizReceipt`;
    qrById('quiz-title').textContent = qrQuiz.title;
    qrById('quiz-description').textContent = qrQuiz.description;
    qrById('quiz-description').hidden = !qrQuiz.description;
    qrById('quiz-question-count').textContent = `${qrQuiz.questions.length} questions`;
    qrRenderQuestions();
    qrUpdateProgress();
    qrById('quiz-form').addEventListener('submit', qrCheckAnswers);
    qrById('question-list').addEventListener('change', () => qrClearGrade('Answers changed. Check again to refresh feedback and your receipt.'));
    qrById('retry-button').addEventListener('click', qrRetryMissed);
    qrById('reset-button').addEventListener('click', () => {
      qrRestoreAnswers({});
      qrClearGrade('All answers cleared. Start a fresh attempt.');
      qrQuestionNodes.values().next().value?.options.values().next().value?.input.focus();
    });
    qrById('receipt-file').addEventListener('change', qrImportReceipt);
    qrById('receipt-button').addEventListener('click', qrDownloadReceipt);
    qrSyncButtons();
    try {
      const fingerprint = await fingerprintQuiz(qrQuiz);
      qrById('quiz-fingerprint').textContent = fingerprint;
    } catch {
      qrReceiptCapability = false;
      qrCapabilityError = 'This browser cannot calculate the quiz fingerprint. Answer checking is available, but receipt export and import require a browser with Web Crypto support.';
      qrById('quiz-fingerprint').textContent = 'SHA-256 is unavailable in this browser.';
      qrById('receipt-file').disabled = true;
      qrError(qrCapabilityError);
      qrSyncButtons();
    }
  } catch (error) {
    qrQuiz = null;
    qrById('quiz-title').textContent = 'This quiz could not be loaded';
    qrError(error instanceof Error ? error.message : 'The quiz data is invalid.');
    qrById('receipt-file').disabled = true;
    qrById('reset-button').disabled = true;
    qrSyncButtons();
  }
}

qrStart();
