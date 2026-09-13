// Shared word tokenizer for the spelling engine.
const WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)?(?:-[A-Za-z0-9]+)*/g;

function tokenize(sentence) {
  WORD_RE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = WORD_RE.exec(sentence))) out.push({ word: m[0], start: m.index });
  return out;
}

// Tokens that are never spelling errors: identifiers, numbers, URLs/emails, acronyms.
function isSkippableToken(word, before, after) {
  if (!word || word.length <= 1) return true;
  if (word.length > 32) return true;
  if (/\d/.test(word)) return true;
  if (/[A-Z]/.test(word.slice(1))) return true; // camelCase / identifiers
  if (before === '@' || before === '.' || before === '/' || after === '@') return true;
  if (/^[A-Z]{2,5}$/.test(word)) return true; // NASA, HTML
  return false;
}

module.exports = { tokenize, isSkippableToken, activeTokenSpan };

// The word the user is actively typing: caret inside it, or at its end with
// no boundary after it (more letters may follow). Completed words (space or
// punctuation after, caret elsewhere) return null and are always checked.
function activeTokenSpan(text, caret) {
  if (caret == null || caret < 0 || caret > text.length) return null;
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(text))) {
    const s = m.index, e = s + m[0].length;
    if (caret > s && caret < e) return { start: s, end: e }; // editing inside
    if (caret === e) {
      const after = text[e] || '';
      if (e === text.length || /[A-Za-z0-9']/.test(after)) return { start: s, end: e };
      return null; // completed word (boundary after it)
    }
    if (s > caret) break;
  }
  return null;
}
