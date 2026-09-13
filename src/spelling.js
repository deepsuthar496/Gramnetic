// Spelling engine: nspell + dictionary-en (Hunspell-compatible, local, no network).
// Only ranking tweak: a micro-map of ultra-common transposition typos where
// nspell's raw ranking buries the obvious fix (teh -> the). Not a dictionary.
const { tokenize, isSkippableToken } = require('./tokens');

const COMMON_FIXES = {
  teh: ['the'],
  hte: ['the'],
  adn: ['and'],
  taht: ['that'],
  thier: ['their'],
  yuo: ['you'],
  wiht: ['with'],
  // word-form / word-choice errors nspell's raw ranking buries or gets wrong:
  alot: ['a lot'],
  aswell: ['as well'],
  infront: ['in front'],
  incase: ['in case'],
  infact: ['in fact'],
  atleast: ['at least'],
  nomatter: ['no matter'],
  ofcourse: ['of course'],
  inspite: ['in spite'],
  wich: ['which'],
  recieve: ['receive'],
  childs: ['children'],
  womans: ['women'],
  tooths: ['teeth'],
  foots: ['feet'],
  sheeps: ['sheep'],
  deers: ['deer'],
  oxes: ['oxen'],
  criterias: ['criteria'],
  phenomenas: ['phenomena'],
  bacterias: ['bacteria'],
  advices: ['advice'],
  informations: ['information'],
  furnitures: ['furniture'],
  equipments: ['equipment'],
  knowledges: ['knowledge'],
  luggages: ['luggage'],
  traffics: ['traffic'],
  homeworks: ['homework'],
  datas: ['data'],
  evidences: ['evidence'],
  hisself: ['himself'],
  theirselves: ['themselves'],
  themself: ['themselves'],
  becuase: ['because'],
  beacuse: ['because'],
  definately: ['definitely'],
  seperate: ['separate'],
  occured: ['occurred'],
  untill: ['until'],
  wich: ['which'],
  ture: ['true'],
  beleive: ['believe']
};

function createSpelling(spell, stores) {
  const suggestCache = new Map();

  function knownWord(word) {
    try {
      return spell.correct(word);
    } catch {
      return false;
    }
  }

  function isCorrect(word, lower) {
    if (stores.isCustom(lower) || stores.isIgnored(lower)) return true;
    if (knownWord(word)) return true;
    if (word !== lower && knownWord(lower)) return true;
    // possessives: "dog's" -> "dog"
    if (lower.endsWith("'s") && knownWord(lower.slice(0, -2))) return true;
    if (lower.endsWith("s'") && knownWord(lower.slice(0, -1))) return true;
    return false;
  }

  function suggestions(lower) {
    if (suggestCache.has(lower)) return suggestCache.get(lower);
    const out = [];
    for (const s of COMMON_FIXES[lower] || []) out.push(s);
    try {
      for (const s of spell.suggest(lower).slice(0, 8)) {
        if (!out.includes(s) && out.length < 5) out.push(s);
      }
    } catch {
      /* suggest best-effort */
    }
    const res = out.slice(0, 3);
    suggestCache.set(lower, res);
    if (suggestCache.size > 2000) suggestCache.clear();
    return res;
  }

  // active: {start,end} of the word under the cursor (still being typed) —
  // never flagged, so pausing mid-word shows no red underline.
  function overlapsActive(start, end, active) {
    return !!active && start < active.end && end > active.start;
  }

  function checkSpelling(sentence, active = null) {
    const errs = [];
    for (const { word, start } of tokenize(sentence)) {
      const end = start + word.length;
      if (overlapsActive(start, end, active)) continue;
      const lower = word.toLowerCase();
      if (isCorrect(word, lower)) continue;
      if (isSkippableToken(word, sentence[start - 1] || '', sentence[start + word.length] || '')) continue;
      errs.push({
        id: `sp-${start}-${start + word.length}`,
        type: 'spelling',
        start,
        end: start + word.length,
        originalText: word,
        message: 'Possible spelling mistake',
        suggestions: suggestions(lower)
      });
    }
    return errs;
  }

  // Corrected view: replace each misspelled word with its top suggestion so the
  // grammar engine can see through typos ("economay play" -> "economy play").
  // Returns the corrected text plus a mapper from corrected offsets back to
  // original offsets (points inside a replaced token snap to its boundaries).
  function correctText(text, active = null) {
    const edits = []; // {oStart,oEnd,cStart,cEnd}
    let out = '';
    let oPos = 0;
    for (const { word, start } of tokenize(text)) {
      const end = start + word.length;
      if (overlapsActive(start, end, active)) continue;
      const lower = word.toLowerCase();
      if (isCorrect(word, lower)) continue;
      if (isSkippableToken(word, text[start - 1] || '', text[start + word.length] || '')) continue;
      const sug = suggestions(lower);
      if (!sug.length) continue;
      let rep = sug[0];
      if (/^[A-Z]/.test(word) && /^[a-z]/.test(rep)) rep = rep[0].toUpperCase() + rep.slice(1);
      out += text.slice(oPos, start);
      const cStart = out.length;
      out += rep;
      edits.push({ oStart: start, oEnd: start + word.length, cStart, cEnd: out.length });
      oPos = start + word.length;
    }
    out += text.slice(oPos);
    function mapPoint(p, isEnd) {
      let delta = 0;
      for (const e of edits) {
        if (p < e.cStart) break;
        if (p < e.cEnd) return isEnd ? e.oEnd : e.oStart;
        delta += (e.oEnd - e.oStart) - (e.cEnd - e.cStart);
      }
      return p + delta;
    }
    function mapRange(s, e) {
      if (s === e) {
        const p = mapPoint(s, false); // zero-width markers (append-?) stay zero-width
        return [p, p];
      }
      return [mapPoint(s, false), mapPoint(e, true)];
    }
    return { text: out, mapRange, changed: edits.length > 0 };
  }

  return { checkSpelling, suggestions, knownWord, correctText, clearCache: () => suggestCache.clear() };
}

module.exports = { createSpelling };
