# Authoring a useful lesson

Start from `examples/javascript.json` and keep the answer choices literal. When the concept is a code identifier or expression result, put that exact text in the label. Prompts and labels support plain text and newlines.

Give each option a reason tied to that option. Explain the misconception behind an incorrect choice and the reasoning behind the correct one. The question-level explanation should connect those details to the concept being tested.

Review the answer key independently before building. Schema validation establishes that the data is structurally usable. It cannot establish whether the teaching is accurate.

An authoring request can use this short template.

> Create a QuizReceipt v1 JSON lesson using the supplied schema. Preserve technical identifiers exactly in answer labels. Write one correct option per question, a specific explanation for every option and a question-level explanation. Use only facts supported by the reference material I supply. List uncertain claims separately for review before producing the final JSON.

Validate, build, try the lesson with both correct and incorrect choices, then export and verify a receipt. Keep the original quiz JSON with the lesson. Changes to prompts, labels, ordering, answers or explanations change the fingerprint, so receipts from an earlier version require that earlier quiz.

Share feedback records only with the intended audience. They include selected answers, correct option IDs and explanations. A record can be edited, and the HTML contains its answer key. Use QuizReceipt for practice and feedback handoffs.
