/**
 * Compares a submitted answer against the stored correct answer.
 * Always trims + collapses internal whitespace. Case sensitivity is
 * opt-in per question (case_sensitive = 1).
 */
function normalize(str) {
  return String(str ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function isAnswerCorrect(submitted, correct, caseSensitive) {
  let a = normalize(submitted);
  let b = normalize(correct);
  if (!caseSensitive) {
    a = a.toLowerCase();
    b = b.toLowerCase();
  }
  return a === b && a.length > 0;
}

module.exports = { isAnswerCorrect, normalize };
