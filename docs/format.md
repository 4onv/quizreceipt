# Quiz and receipt format v1

Every quiz field in the README example is required, including `description` (which may be empty). Extra fields are rejected. Prompts, labels and explanations must contain some non-whitespace text. Whitespace in accepted strings is preserved.

| Field | Limit |
| --- | --- |
| Quiz/question/option ID | 1–64 ASCII characters, starting with a letter, then letters, digits, `_` or `-` |
| Title | 160 UTF-16 code units |
| Description | 2,000 UTF-16 code units |
| Prompt | 4,000 UTF-16 code units |
| Option label | 1,000 UTF-16 code units |
| Question or option explanation | 4,000 UTF-16 code units |
| Questions | 1–50 |
| Options per question | 2–6 |
| Canonical quiz | 512 KiB UTF-8 |
| Input JSON / receipt | 1 MiB UTF-8 |

Object-prototype property names and `prototype` are reserved IDs. Question IDs must be unique in the quiz. Option IDs and exact option labels must be unique within each question. `answer` must reference an option in the same question. Lone Unicode surrogates are rejected.

## Canonicalization and fingerprint

`validateQuiz(input)` returns a fresh normalized object in this field order.

1. Quiz fields `version`, `id`, `title`, `description`, `questions`.
2. Question fields `id`, `prompt`, `options`, `answer`, `explanation`.
3. Option fields `id`, `label`, `explanation`.

`canonicalQuiz(input)` is `JSON.stringify` of that validated object without indentation or a trailing newline. `fingerprintQuiz` encodes the canonical string as UTF-8 and computes SHA-256, returned as 64 lowercase hexadecimal characters.

Object key ordering and formatting of the input JSON do not affect the fingerprint. Array ordering, exact strings, whitespace inside strings, IDs, answer keys and explanations do affect it. Unicode normalization is not applied.

## Answers and grading

`gradeQuiz(quiz, answers)` accepts an object keyed by question ID. Each value is an option ID or `null`. Missing keys are treated as unanswered. Unknown question or option IDs are rejected. Each correct answer contributes one point. Results contain `total`, `correct`, `incorrect`, `unanswered` and an ordered `questions` array.

Each result row contains `questionId`, `selectedOptionId`, `correctOptionId`, `status`, `explanation` and `selectedExplanation`. Status is `correct`, `incorrect` or `unanswered`. An unanswered row has null selected fields.

## Receipts

`createReceipt(quiz, answers)` returns the following shape with every answer key included.

```json
{
  "version": 1,
  "quizId": "membership-lesson",
  "quizSha256": "<64 lowercase hexadecimal characters>",
  "answers": {"includes": "no"},
  "grade": {"total": 1, "correct": 1, "incorrect": 0, "unanswered": 0, "questions": []}
}
```

The illustration abbreviates the `questions` array. A real receipt must contain all ordered rows and fields produced by `gradeQuiz`. Use `createReceipt` to obtain a valid record.

`verifyReceipt(quiz, receipt)` checks all fields, ID and digest, then recomputes every result. It accepts reordered object keys and requires the original ordered question array. It throws on mismatches and otherwise returns `{valid: true, quizId, quizSha256, grade}`. Verification establishes consistency with the supplied content and selections. A consistently edited receipt can still pass.

The CLI and browser imports use a bounded parser that rejects duplicate object keys, malformed JSON, non-finite numeric values and nesting deeper than 24 levels. `parseJson` creates null-prototype data objects. The shared API accepts both plain and null-prototype objects, while rejecting accessors, sparse arrays and extra fields.
