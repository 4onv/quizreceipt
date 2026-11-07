/** Shared deterministic grading and receipt validation for Node.js and browsers. */
export const LIMITS = Object.freeze({
  maxQuestions: 50,
  minOptions: 2,
  maxOptions: 6,
  maxIdLength: 64,
  maxTitleLength: 160,
  maxDescriptionLength: 2000,
  maxPromptLength: 4000,
  maxLabelLength: 1000,
  maxExplanationLength: 4000,
  maxQuizBytes: 512 * 1024,
  maxReceiptBytes: 1024 * 1024,
});

const RESERVED_IDS = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const QUIZ_FIELDS = ['version', 'id', 'title', 'description', 'questions'];
const QUESTION_FIELDS = ['id', 'prompt', 'options', 'answer', 'explanation'];
const OPTION_FIELDS = ['id', 'label', 'explanation'];
const RECEIPT_FIELDS = ['version', 'quizId', 'quizSha256', 'answers', 'grade'];

function record(value, fields, path, required = fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain data object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !fields.includes(key)) {
      throw new TypeError(`${path} contains an unknown field`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new TypeError(`${path} must contain enumerable data fields`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${path}.${key} is required`);
  }
}

function array(value, min, max, path) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${path} must contain ${min} to ${max} entries`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${path} must be a plain data array`);
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) {
    throw new TypeError(`${path} must be a dense data array`);
  }
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new TypeError(`${path} must be a dense data array`);
    }
  }
}

function text(value, maximum, path, allowEmpty = false) {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string`);
  if (value.length > maximum) throw new RangeError(`${path} exceeds ${maximum} UTF-16 code units`);
  if (!allowEmpty && value.trim().length === 0) throw new TypeError(`${path} must contain text`);
  // A lone surrogate would be replaced by UTF-8 encoding and could create an
  // ambiguous digest. Preserve every valid Unicode code point exactly.
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError(`${path} contains a lone surrogate`);
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError(`${path} contains a lone surrogate`);
    }
  }
  return value;
}

function id(value, path) {
  text(value, LIMITS.maxIdLength, path);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value) || RESERVED_IDS.has(value)) {
    throw new TypeError(`${path} must be an ASCII identifier beginning with a letter and using an unreserved name`);
  }
  return value;
}

function boundedJson(value, maximum, path) {
  const result = JSON.stringify(value);
  if (new TextEncoder().encode(result).length > maximum) {
    throw new RangeError(`${path} exceeds ${maximum} UTF-8 bytes`);
  }
  return result;
}

/** Validate and copy a quiz into the canonical v1 field order. Text stays exact. */
export function validateQuiz(input) {
  record(input, QUIZ_FIELDS, 'quiz');
  if (input.version !== 1) throw new TypeError('quiz.version must be 1');
  array(input.questions, 1, LIMITS.maxQuestions, 'quiz.questions');
  const questionIds = new Set();
  const questions = input.questions.map((question, index) => {
    const path = `quiz.questions[${index}]`;
    record(question, QUESTION_FIELDS, path);
    const questionId = id(question.id, `${path}.id`);
    if (questionIds.has(questionId)) throw new TypeError(`${path}.id duplicates a question identifier`);
    questionIds.add(questionId);
    array(question.options, LIMITS.minOptions, LIMITS.maxOptions, `${path}.options`);
    const optionIds = new Set();
    const labels = new Set();
    const options = question.options.map((option, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`;
      record(option, OPTION_FIELDS, optionPath);
      const optionId = id(option.id, `${optionPath}.id`);
      if (optionIds.has(optionId)) throw new TypeError(`${optionPath}.id duplicates an option identifier`);
      optionIds.add(optionId);
      const label = text(option.label, LIMITS.maxLabelLength, `${optionPath}.label`);
      if (labels.has(label)) throw new TypeError(`${optionPath}.label duplicates an exact option label`);
      labels.add(label);
      return {
        id: optionId,
        label,
        explanation: text(option.explanation, LIMITS.maxExplanationLength, `${optionPath}.explanation`),
      };
    });
    const answer = id(question.answer, `${path}.answer`);
    if (!optionIds.has(answer)) throw new TypeError(`${path}.answer must name an option in this question`);
    return {
      id: questionId,
      prompt: text(question.prompt, LIMITS.maxPromptLength, `${path}.prompt`),
      options,
      answer,
      explanation: text(question.explanation, LIMITS.maxExplanationLength, `${path}.explanation`),
    };
  });
  const quiz = {
    version: 1,
    id: id(input.id, 'quiz.id'),
    title: text(input.title, LIMITS.maxTitleLength, 'quiz.title'),
    description: text(input.description, LIMITS.maxDescriptionLength, 'quiz.description', true),
    questions,
  };
  boundedJson(quiz, LIMITS.maxQuizBytes, 'quiz');
  return quiz;
}

/** Canonical UTF-8 input for the v1 digest. Object order is fixed, arrays retained. */
export function canonicalQuiz(input) {
  return JSON.stringify(validateQuiz(input));
}

export async function fingerprintQuiz(input) {
  const canonical = canonicalQuiz(input);
  if (!globalThis.crypto?.subtle) {
    throw new Error('SHA-256 requires Web Crypto. Use Node.js 22+ or a browser with secure-context Web Crypto support.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeAnswers(quiz, answers, requireAll = false) {
  const fields = quiz.questions.map(question => question.id);
  record(answers, fields, 'answers', requireAll ? fields : []);
  const normalized = {};
  for (const question of quiz.questions) {
    const selected = Object.hasOwn(answers, question.id) ? answers[question.id] : null;
    if (selected !== null && (typeof selected !== 'string' || !question.options.some(option => option.id === selected))) {
      throw new TypeError(`answers.${question.id} must be null or an option identifier from that question`);
    }
    normalized[question.id] = selected;
  }
  return normalized;
}

function gradeNormalized(quiz, answers) {
  const questions = quiz.questions.map(question => {
    const selected = answers[question.id];
    const option = question.options.find(candidate => candidate.id === selected);
    return {
      questionId: question.id,
      selectedOptionId: selected,
      correctOptionId: question.answer,
      status: selected === null ? 'unanswered' : selected === question.answer ? 'correct' : 'incorrect',
      explanation: question.explanation,
      selectedExplanation: option?.explanation ?? null,
    };
  });
  return {
    total: questions.length,
    correct: questions.filter(question => question.status === 'correct').length,
    incorrect: questions.filter(question => question.status === 'incorrect').length,
    unanswered: questions.filter(question => question.status === 'unanswered').length,
    questions,
  };
}

/** Each question contributes one point. Missing answer keys are unanswered. */
export function gradeQuiz(input, answers) {
  const quiz = validateQuiz(input);
  return gradeNormalized(quiz, normalizeAnswers(quiz, answers));
}

/** Create a replayable, editable record. This is not an identity attestation. */
export async function createReceipt(input, answers) {
  const quiz = validateQuiz(input);
  const normalized = normalizeAnswers(quiz, answers);
  const receipt = {
    version: 1,
    quizId: quiz.id,
    quizSha256: await fingerprintQuiz(quiz),
    answers: normalized,
    grade: gradeNormalized(quiz, normalized),
  };
  boundedJson(receipt, LIMITS.maxReceiptBytes, 'receipt');
  return receipt;
}

function assertSame(actual, expected, path) {
  if (Array.isArray(expected)) {
    array(actual, expected.length, expected.length, path);
    expected.forEach((item, index) => assertSame(actual[index], item, `${path}[${index}]`));
  } else if (expected !== null && typeof expected === 'object') {
    record(actual, Object.keys(expected), path);
    for (const key of Object.keys(expected)) assertSame(actual[key], expected[key], `${path}.${key}`);
  } else if (actual !== expected) {
    throw new TypeError(`${path} does not match the recomputed grading`);
  }
}

/** Recompute a receipt against its exact quiz. A successful check proves consistency. */
export async function verifyReceipt(input, receipt) {
  const quiz = validateQuiz(input);
  const digest = await fingerprintQuiz(quiz);
  // Validate all receipt fields together after the asynchronous hash finishes.
  // This prevents edits during hashing from bypassing the initial field check.
  record(receipt, RECEIPT_FIELDS, 'receipt');
  if (receipt.version !== 1) throw new TypeError('receipt.version must be 1');
  if (receipt.quizId !== quiz.id) throw new TypeError('receipt.quizId does not match the supplied quiz');
  if (typeof receipt.quizSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.quizSha256)) {
    throw new TypeError('receipt.quizSha256 must be a lowercase SHA-256 hex digest');
  }
  if (receipt.quizSha256 !== digest) throw new TypeError('receipt.quizSha256 does not match the exact supplied quiz');
  const answers = normalizeAnswers(quiz, receipt.answers, true);
  const grade = gradeNormalized(quiz, answers);
  assertSame(receipt.grade, grade, 'receipt.grade');
  // All fields are now data-only and bounded by the validated quiz/expected grade.
  boundedJson(receipt, LIMITS.maxReceiptBytes, 'receipt');
  return { valid: true, quizId: quiz.id, quizSha256: digest, grade };
}
