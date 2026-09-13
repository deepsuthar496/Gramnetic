// Local rule-based grammar + punctuation engine (Harper-role in PLAN section 11:
// grammar/writing rules live here; spelling lives in spelling.js).
// Pure functions: checkGrammar(sentence, knownWord). No DOM, unit-testable.
const { tokenize } = require('./tokens');

const THIRD_SINGULAR = {
  go: 'goes', have: 'has', do: 'does', say: 'says', make: 'makes', take: 'takes',
  come: 'comes', run: 'runs', write: 'writes', speak: 'speaks', eat: 'eats',
  sleep: 'sleeps', work: 'works', play: 'plays', study: 'studies', watch: 'watches',
  like: 'likes', want: 'wants', need: 'needs', know: 'knows', think: 'thinks',
  feel: 'feels', live: 'lives', love: 'loves', try: 'tries', cry: 'cries',
  fly: 'flies', carry: 'carries'
};
const AN_EXCEPTIONS = new Set(['hour', 'hours', 'honest', 'honestly', 'honor', 'honour', 'heir', 'herb']);

// Plural subjects that pair with a base verb ("people likes" -> "like").
const PLURAL_SUBJECTS = new Set('people men women children teeth feet mice geese oxen dogs cats birds boys girls students teachers friends parents brothers sisters babies cars books houses schools trees flowers days years things countries cities stories families phones computers movies songs games teams players workers farmers drivers writers readers ladies'.split(' '));
// Singular subjects for sentence-initial "The dog bark" -> "barks". Indefinite
// pronouns included ("Everyone like" -> "likes"). Deliberately excludes
// one/each/either/neither (usually determiners: "One answer is correct").
const SINGULAR_NOUNS = new Set('fox dog cat bird boy girl man woman child baby mother father parent brother sister son daughter king queen doctor driver farmer writer reader player worker student teacher friend horse cow lion tiger bear fish sheep deer mouse car bus train plane ship boat book house school tree flower river mountain sun moon star phone computer movie song game team bell ball box cup door window wall roof floor bed chair table lamp economy country city nation company government group class party society world market industry bank chart graph table diagram report essay article process system project program picture photo image map list everyone everybody someone somebody anyone anybody nobody'.split(' '));
// Base verbs allowed in agreement rules: common action verbs that are rarely
// nouns, so "a dog house" never flags but "a fox jump" does.
const VERB_BASES = new Set([...Object.keys(THIRD_SINGULAR), 'jump', 'walk', 'swim', 'ride', 'drive', 'climb', 'fall', 'rise', 'grow', 'sing', 'dance', 'bark', 'laugh', 'smile', 'read', 'drink', 'cook', 'clean', 'wash', 'help', 'call', 'ask', 'answer', 'open', 'close', 'start', 'stop', 'rain', 'snow', 'shine', 'fight', 'hide', 'seek', 'bake', 'march', 'crawl', 'howl', 'roar', 'hop', 'skip', 'hunt', 'fish', 'shop', 'travel', 'visit', 'paint', 'build', 'break', 'bring', 'buy', 'catch', 'choose', 'forget', 'freeze', 'ring', 'shake', 'steal', 'tear', 'wake', 'wear', 'win',
  // collocation verbs for the article/preposition rules (skills for, apply,
  // increase quality...): needed in agreement too ("They provides" -> "provide").
  'provide', 'apply', 'utilize', 'utilise', 'increase', 'improve', 'enhance', 'boost', 'raise',
  // common verbs learners misparse as subjects ("look forward", "hear from",
  // "learn fast", "keep quiet").
  'learn', 'teach', 'look', 'listen', 'hear', 'see', 'keep', 'allow', 'leave', 'move', 'stop',
  'wait', 'include', 'contain', 'produce', 'reduce', 'focus', 'compare', 'encourage', 'suggest',
  'recommend', 'worry', 'spend', 'stay', 'beat', 'treat', 'care', 'share', 'express',
  'communicate', 'socialize', 'invite', 'explain', 'describe', 'mention', 'prepare', 'create',
  'develop', 'perform', 'decide', 'hope', 'expect', 'agree', 'refuse', 'promise', 'offer',
  // imperatives: almost never subjects ("Give dog a bone", "Run test daily")
  'give', 'get', 'tell', 'show', 'send', 'leave', 'keep', 'hold', 'put', 'set', 'pay', 'meet', 'watch', 'see', 'hear', 'feel', 'smell', 'taste', 'run', 'sit', 'stand', 'rest', 'save', 'load', 'print', 'delete', 'upload', 'download', 'search', 'sort', 'lock', 'unlock', 'turn', 'draw', 'cut', 'phone', 'prefer', 'listen', 'need', 'use', 'fix', 'test', 'debug', 'deploy', 'merge', 'push', 'pull', 'fetch', 'commit', 'clone', 'install', 'cancel', 'confirm', 'verify', 'reset', 'add', 'remove', 'edit', 'create', 'join', 'forward', 'attach', 'enter', 'select', 'share', 'post', 'press', 'click', 'insert', 'filter']);

// Verb-capable nouns ("Report bug now" is imperative, "The report show growth"
// is an error): skipped as subjects only at sentence start, where the
// imperative reading dominates. Anywhere else they check normally.
const VERBCAP = new Set(['report', 'update', 'order', 'plan', 'change', 'note', 'check', 'command', 'demand', 'request', 'offer', 'promise', 'result', 'return', 'review', 'lead', 'state', 'reply']);
const HAVE_FIX = { has: 'have' };
const DET_WORDS = 'a|an|the|my|your|his|her|its|our|their|this|that|each|every';
const SING_LIST = [...SINGULAR_NOUNS].join('|');
// Clause linkers that can precede a mid-sentence subject ("as economy play").
const CONJ = 'and|but|or|nor|so|for|as|because|since|while|when|if|although|though|whereas|plus';

// Causative/perception verbs whose complement stays base ("let the dog run").
// End-anchored: tested against the text right before the subject noun.
const CAUS = /(?:^|\s)(let|make|have|help|watch|see|hear|feel|get)\s+(?:a|an|the|my|your|his|her|its|our|their|this|that)?\s*$/i;

// Same-form nouns: plural-looking but singular-or-plural ("fish"). Only treated
// as singular subjects after a/an/one ("a fish swim" -> "swims", but "the fish
// swim" is correct and left alone).
const SAMEFORM = new Set(['fish', 'sheep', 'deer']);

// Function words that can never be subjects (determiners, pronouns,
// prepositions, conjunctions, adverbs, discourse markers, ordinals...).
const STOPWORDS = new Set(('a an the my your his her its our their this that these those ' +
'i you he she it we they me him her us them mine yours hers ours theirs myself yourself himself herself itself ourselves yourselves themselves ' +
'who whom whose which what when where why how ' +
'and but or nor so for as of at by to in on with from into during before after above below between among against across behind beyond over under through without within along toward upon via per plus except despite than because since while although though whereas ' +
'not no very too so quite rather only also even still yet now today tonight tomorrow yesterday ago away back home up down out off here there then again once twice always often usually sometimes never ever almost nearly mostly hardly barely already hence thus therefore however moreover furthermore otherwise instead meanwhile anyway besides ' +
'all any some more most other another such own same each every either neither both few many much one two three first second third fourth fifth sixth seventh eighth ninth tenth last next ' +
'hello hi hey yes no ok okay thanks thank please sorry welcome well oh ah').split(/\s+/));

// Common adjectives: as subjects they'd need plural verbs anyway ("the poor
// suffer" is correct), so they only pollute the noun slot ("brown fox").
const ADJECTIVES = new Set(('red green blue yellow black white brown gray grey pink orange purple golden silver beige ' +
'big small large little long short high low tall wide narrow deep thick thin huge tiny vast ' +
'old new young ancient modern antique given taken broken written spoken driven shown known grown thrown drawn worn torn beaten hidden running working walking talking living dying crying flying swimming smiling laughing ' +
'daily weekly monthly yearly ' +
'good bad great excellent poor rich cheap expensive clean dirty easy hard difficult soft loud quiet hot cold warm cool dry wet full empty strong weak fast slow quick early late bright dark heavy light smooth rough sharp clear obvious simple complex common normal regular special strange true false real whole entire mere sheer utter main major minor prime sole same different able unable ready willing sorry glad sure afraid alike alive asleep awake aware vital fatal legal illegal local total final formal normal moral rural urban central lethal mortal natal regal best worst better worse greater live ' +
'happy sad angry hungry thirsty tired bored excited busy free sick ill healthy calm nervous proud surprised worried scared confident').split(/\s+/));

// Ambiguous number: plural-looking mass nouns ("data show" is correct).
const AMBIG = new Set(['data', 'media', 'criteria', 'phenomena', 'bacteria', 'algae', 'fungi']);

// Auxiliaries can never be subjects ("She has" -> "has" is the verb, not a noun).
const NOUN_AUX = new Set(['has', 'have', 'had', 'do', 'does', 'did']);

// Any known content word can be a singular subject — not just a curated list.
// Trusted nouns skip the extra gates; generalized ones must additionally dodge
// adjectives, function words, verb forms ("goes"), and ambiguous nouns.
function isSubjectNoun(word, knownWord) {
  const lw = word.toLowerCase();
  if (lw.includes("'")) return false; // don't/doesn't/dog's — never a bare subject
  if (BE_MODAL.has(lw) || NOUN_AUX.has(lw)) return false;
  if (PAST_TO_BASE[lw]) return false; // went/wrote... are verbs, not subjects
  if (SINGULAR_NOUNS.has(lw)) return !isPluralNoun(word, knownWord);
  if (lw.length < 3 || !knownWord(lw)) return false;
  if (STOPWORDS.has(lw) || ADJECTIVES.has(lw) || AMBIG.has(lw) || VERB_BASES.has(lw)) return false;
  if (isPluralNoun(word, knownWord)) return false;
  if (lw.endsWith('s') && (SINGULAR_S_WORDS.has(lw) || baseOfS(lw, knownWord))) return false;
  // past participles ("received your" — "received" is the verb, not a subject)
  if (/ed$/i.test(lw) && baseOfEd(lw, knownWord)) return false;
  return true;
}

// verb slot must never be these (be/aux/modals owned by other rules).
// have/do stay allowed: "friend have" -> "has" is correct even before
// participles ("dog have eaten" -> "has eaten").
const VERB_BAD = new Set('is are was were be been being am will would can could shall should may might must no not please thanks sorry welcome hello well ok okay hey hi'.split(' '));
const BE_MODAL = new Set('is are was were be been being am will would can could shall should may might must'.split(' '));

// after a candidate verb, these signal a noun compound, not a verb phrase:
// be-forms ("dog house is red") or another noun ("dog house designs")
const FOLLOW_BE = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', 'am']);
function pushGrammar(errs, type, start, end, originalText, message, suggestions, extra) {
  errs.push({ id: `gr-${start}-${end}-${originalText}`, type, start, end, originalText, message, suggestions, ...extra });
}

// "likes" -> "like", "tries" -> "try", "goes" -> "go", "has" -> "have".
function baseOfS(w, knownWord) {
  if (HAVE_FIX[w]) return HAVE_FIX[w];
  const cands = [];
  if (w.endsWith('ies') && w.length > 4) cands.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) cands.push(w.slice(0, -2));
  cands.push(w.slice(0, -1));
  return cands.find((c) => knownWord(c));
}

// Words ending in "s" that are NOT plural: possessive pronouns ("his" -> "hi"
// is a real word), uncountables ("news"), and same-form nouns ("series").
const SINGULAR_S_WORDS = new Set('his hers its ours yours theirs this us news mathematics maths physics politics economics measles mumps shingles billiards darts athletics gymnastics lens means series species corps headquarters crossroads gallows sometimes towards besides afterwards unawares'.split(' '));

function singularOfPlural(w, knownWord) {
  const cands = [];
  if (w.endsWith('ies') && w.length > 4) cands.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) cands.push(w.slice(0, -2));
  cands.push(w.slice(0, -1));
  return cands.find((c) => knownWord(c)) || null;
}

// people, ideas, dogs... (explicit list + any -s word with a known singular)
function isPluralNoun(word, knownWord) {
  const lw = word.toLowerCase();
  if (PLURAL_SUBJECTS.has(lw)) return true;
  if (!lw.endsWith('s') || lw.length < 3) return false;
  if (SINGULAR_S_WORDS.has(lw)) return false;
  if (!knownWord(lw)) return false;
  return !!singularOfPlural(lw, knownWord);
}

// "jump" -> "jumps", "wash" -> "washes", "house" -> "houses",
// "satisfy" -> "satisfies". Pure form check (no verb-list gate): callers
// apply subject/follow guards.
function conjOf(w, knownWord) {
  if (THIRD_SINGULAR[w]) return THIRD_SINGULAR[w];
  // consonant+y verbs ("satisfy"); never nouns/adjectives ("baby", "sorry")
  if (/[^aeiou]y$/.test(w) && !SINGULAR_NOUNS.has(w) && !STOPWORDS.has(w) && !ADJECTIVES.has(w)) {
    if (knownWord(w.slice(0, -1) + 'ies')) return w.slice(0, -1) + 'ies';
  }
  if (/(s|sh|ch|x|z)$/.test(w) || w.endsWith('o')) {
    if (knownWord(w + 'es')) return w + 'es';
  } else if (knownWord(w + 's')) return w + 's';
  return null;
}

// ---- general word-form helpers (articles/determiners/verb complements) ----
// singular noun -> plural ("book"->"books", "city"->"cities"). Known-word
// gated: returns null instead of inventing words.
function pluralOf(w, knownWord) {
  const cands = [];
  if (/[^aeiou]y$/i.test(w)) cands.push(w.slice(0, -1) + 'ies');
  if (/(s|sh|ch|x|z)$/i.test(w) || /o$/i.test(w)) cands.push(w + 'es');
  cands.push(w + 's');
  return cands.find((c) => knownWord(c.toLowerCase())) || null;
}
// base verb -> gerund ("run"->"running", "write"->"writing"). Gated.
function gerundOf(w, knownWord) {
  const cands = [];
  if (/[^aeiou]e$/i.test(w) && !/ee$/i.test(w)) cands.push(w.slice(0, -1) + 'ing');
  if (/^[^aeiou]*[aeiou][bcdfghjklmnpqrstvwxyz]$/i.test(w) && w.length >= 3 && !/(w|x|y)$/i.test(w))
    cands.push(w + w[w.length - 1] + 'ing');
  cands.push(w + 'ing');
  return cands.find((c) => knownWord(c.toLowerCase())) || null;
}
// gerund -> base ("running"->"run", "writing"->"write"). Gated.
function baseOfIng(w, knownWord) {
  if (!/ing$/i.test(w) || w.length <= 4) return null;
  const stem = w.slice(0, -3);
  const cands = [stem];
  if (/(.)\1$/i.test(stem)) cands.push(stem.slice(0, -1));
  cands.push(stem + 'e');
  return cands.find((c) => knownWord(c.toLowerCase())) || null;
}
// regular past -> base ("walked"->"walk", "tried"->"try", "stopped"->"stop").
function baseOfEd(w, knownWord) {
  if (!/ed$/i.test(w) || w.length <= 3) return null;
  const cands = [];
  if (/ied$/i.test(w)) cands.push(w.slice(0, -3) + 'y');
  cands.push(w.slice(0, -2));
  const st = w.slice(0, -2);
  if (/(.)\1$/i.test(st)) cands.push(st.slice(0, -1));
  cands.push(w.slice(0, -1));
  return cands.find((c) => knownWord(c.toLowerCase())) || null;
}
// irregular past -> base; simple-past -> participle for perfect tenses.
const PAST_TO_BASE = { went: 'go', came: 'come', saw: 'see', ate: 'eat', wrote: 'write', spoke: 'speak', took: 'take', got: 'get', did: 'do', had: 'have', made: 'make', said: 'say', thought: 'think', brought: 'bring', bought: 'buy', caught: 'catch', chose: 'choose', forgot: 'forget', froze: 'freeze', rang: 'ring', shook: 'shake', stole: 'steal', tore: 'tear', woke: 'wake', wore: 'wear', won: 'win', ran: 'run', swam: 'swim', rode: 'ride', drove: 'drive', fell: 'fall', rose: 'rise', grew: 'grow', sang: 'sing' };
const PAST_TO_PART = { went: 'gone', came: 'come', saw: 'seen', ate: 'eaten', wrote: 'written', spoke: 'spoken', took: 'taken', did: 'done' };
// mass nouns learners pluralize ("advices"->"advice").
const UNCOUNT_FIX = { advices: 'advice', informations: 'information', furnitures: 'furniture', equipments: 'equipment', knowledges: 'knowledge', luggages: 'luggage', traffics: 'traffic', homeworks: 'homework', datas: 'data', evidences: 'evidence' };
// irregular plural spellings ("childs"->"children").
const IRREG_PLURAL_FIX = { childs: 'children', womans: 'women', tooths: 'teeth', foots: 'feet', sheeps: 'sheep', deers: 'deer', oxes: 'oxen', criterias: 'criteria', phenomenas: 'phenomena', bacterias: 'bacteria' };
// verbs taking a gerund ("enjoy to go"->"enjoy going").
const GERUND_VERBS = new Set(['enjoy', 'avoid', 'finish', 'mind', 'consider', 'suggest', 'admit', 'deny', 'risk', 'imagine', 'dislike', 'practise', 'practice', 'keep', 'miss']);
// verbs taking to-infinitive ("want to going"->"want to go").
const TOINF_VERBS = new Set(['want', 'need', 'decide', 'plan', 'hope', 'expect', 'promise', 'agree', 'refuse', 'manage', 'learn', 'offer', 'seem', 'afford', 'fail', 'ask', 'choose']);
// preserve leading-capital when replacing (sentence starts, proper nouns).
function matchCase(sample, word) {
  if (sample === sample.toUpperCase()) return word.toUpperCase();
  if (/^[A-Z]/.test(sample)) return word[0].toUpperCase() + word.slice(1);
  return word;
}
// is a word (possibly the 3rd-person -s form) present in a verb set?
function verbInSet(w, set) {
  if (set.has(w)) return true;
  if (w.endsWith('s')) {
    const st = w.slice(0, -1);
    if (set.has(st)) return true;
    if (st.endsWith('e') && set.has(st + 'e')) return true;
  }
  return false;
}
// base verb -> correct 3rd-person singular ("finish"->"finishes", "deny"->"denies").
function sForm(w) {
  if (/(s|sh|ch|x|z)$/i.test(w) || /o$/i.test(w)) return w + 'es';
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies';
  return w + 's';
}

function checkGrammar(sentence, knownWord = () => false) {
  const errs = [];
  const text = sentence;
  let m;

  // 1. she/he/it + base verb -> 3rd person singular ("She go" -> "goes").
  // Apostrophe after the verb (don't/doesn't/won't) must not be matched.
  const subjRe = /\b(she|he|it|this|that)\s+([a-z]+)(?!')\b/gi;
  const SAME_PAST = new Set('read put cut hurt set shut let cast cost hit spread upset quit'.split(' '));
  while ((m = subjRe.exec(text))) {
    const subj = m[1];
    const verb = m[2].toLowerCase();
    const vs = m.index + m[1].length + 1;
    if (BE_MODAL.has(verb) || NOUN_AUX.has(verb)) continue; // "She can run" is fine
    if (['where', 'when', 'whether', 'wear', 'were'].includes(verb)) continue; // confusions
    if (SAME_PAST.has(verb)) continue; // "He read a book" is past tense
    if (THIRD_SINGULAR[verb]) {
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use '${THIRD_SINGULAR[verb]}' with '${subj}'`, [THIRD_SINGULAR[verb]]);
    } else if (!verb.endsWith('s') && knownWord(verb) && knownWord(verb + 's')) {
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use '${verb}s' with '${subj}'`, [verb + 's']);
    }
  }

  // 2. they/we/you + is|was -> are|were
  const plurRe = /\b(they|we|you)\s+(is|was)\b/gi;
  while ((m = plurRe.exec(text))) {
    const fix = m[2].toLowerCase() === 'is' ? 'are' : 'were';
    const vs = m.index + m[1].length + 1;
    pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2], `Use '${fix}' with '${m[1]}'`, [fix]);
  }
  // 2b. they/we/you + verb-s -> base ("They plays" -> "play")
  const plurVerbRe = /\b(they|we|you)\s+([a-z]+s)(?!')\b/gi;
  while ((m = plurVerbRe.exec(text))) {
    if (/^(is|was)$/i.test(m[2])) continue; // covered above
    const base = baseOfS(m[2].toLowerCase(), knownWord);
    if (base && (VERB_BASES.has(base) || HAVE_FIX[m[2].toLowerCase()])) {
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2], `Use '${base}' with '${m[1]}'`, [base]);
    }
  }
  // 2c. plural noun + verb-s -> base ("people likes" -> "like", "ideas try" is
  // fine but "dogs likes" -> "like"). Generic: any plural subject + verb whose
  // base is a known action verb.
  const plSubRe = /\b([a-z]+)\s+([a-z]+s)(?!')\b/gi;
  while ((m = plSubRe.exec(text))) {
    if (/^(they|we|you)$/i.test(m[1])) continue; // rule 2b owns these
    if (!isPluralNoun(m[1], knownWord)) continue;
    const base = baseOfS(m[2].toLowerCase(), knownWord);
    if (base && (VERB_BASES.has(base) || HAVE_FIX[m[2].toLowerCase()])) {
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2], `Use '${base}' with '${m[1]}'`, [base]);
    }
  }
  // 2d. singular subject + base verb -> conjugate ("chart illustrate" ->
  // "illustrates", "fox jump" -> "jumps"). Occurrence-based, no regex
  // backtracking traps: for every known singular noun, the next word must be
  // a conjugable base verb, the noun must open a subject phrase (determiner /
  // clause boundary / sentence start, tolerating modifiers like ordinals in
  // "second and third table illustrate"), and the following word must not
  // expose a noun compound ("dog house is red", "dog house designs" bail out).
  const toks = tokenize(text);
  const prefixRe = new RegExp(`(^|[,;:()]\\s*|\\b(?:${CONJ})\\s+|\\b(?:${DET_WORDS})\\s+)(?:[a-z']+\\s+){0,3}$`, 'i');
  const oneDetRe = /(?:^|\s)(a|an|one)\s+(?:[a-z']+\s+)*$/i;
  const hits = [];
  for (let j = 0; j < toks.length; j++) {
    const noun = toks[j].word;
    const nl = noun.toLowerCase();
    // sentence start + verb-capable noun ("Give dog", "Report bug", "Cancel
    // order") reads imperative — skip. Mid-sentence they check normally.
    const beforeText = text.slice(0, toks[j].start);
    const atStart = !/[,;:.!?()]\s*$/.test(beforeText.trimEnd()) &&
      !new RegExp(`\\b(?:${CONJ}|${DET_WORDS})\\b\\s*$`, 'i').test(beforeText);
    if (atStart && VERBCAP.has(nl)) continue;
    if (!isSubjectNoun(noun, knownWord)) continue;
    const nEnd = toks[j].start + noun.length;
    const mv = /^[ \t]+([a-zA-Z]+)\b/.exec(text.slice(nEnd, nEnd + 24));
    if (!mv) continue;
    const verb = mv[1];
    const vl = verb.toLowerCase();
    // tiny function words ("a" -> "as") must never enter the verb slot
    if (vl.length < 3 && !THIRD_SINGULAR[vl] && !VERB_BASES.has(vl)) continue;
    if (vl.endsWith('s') || VERB_BAD.has(vl)) continue;
    const fix = conjOf(vl, knownWord);
    if (!fix) continue;
    const vEnd = nEnd + mv[0].length;
    const mf = /^[ \t]*([,.!?;:]|[a-zA-Z]+)?/.exec(text.slice(vEnd, vEnd + 24));
    const fwRaw = mf && mf[1];
    if (fwRaw && /[a-zA-Z]/.test(fwRaw)) {
      const fw = fwRaw.toLowerCase();
      if (FOLLOW_BE.has(fw)) continue;
      const trusted = VERB_BASES.has(vl) || !!THIRD_SINGULAR[vl];
      if (!trusted && SINGULAR_NOUNS.has(fw)) continue; // "brown fox", "house door"
      if (!trusted && isPluralNoun(fw, knownWord)) {
        // object ("eat apples", "nourish plants") or compound subject
        // ("house designs fall")? A verb/be-form/Title after the plural means
        // the plural is the real subject — otherwise the verb takes an object.
        // A noun-y verb ("house") with nothing after the plural is a compound
        // fragment ("house designs.") and bails; a verb-y one ("support",
        // "nourish") still flags.
        const fwEnd = vEnd + mf[0].length;
        const ma = /^[ \t]*([,.!?;:]|[a-zA-Z]+)?/.exec(text.slice(fwEnd, fwEnd + 28));
        const awRaw = ma && ma[1];
        if (!awRaw || /[,.!?;:]/.test(awRaw)) {
          if (SINGULAR_NOUNS.has(vl)) continue;
        } else if (/[a-zA-Z]/.test(awRaw)) {
          const aw = awRaw.toLowerCase();
          if (/^[A-Z]/.test(awRaw) || BE_MODAL.has(aw) || (!aw.endsWith('s') && conjOf(aw, knownWord))) continue;
        }
      }
    }
    const prefix = text.slice(Math.max(0, toks[j].start - 30), toks[j].start);
    if (!prefixRe.test(prefix)) continue;
    if (/(?:^|\s)to\s+$/i.test(prefix)) continue; // infinitive ("try to tackle")
    if (SAMEFORM.has(nl) && !oneDetRe.test(prefix)) continue;
    if (CAUS.test(prefix.slice(-24))) continue;
    const vs = nEnd + mv[0].length - verb.length;
    hits.push({ ns: toks[j].start, vs, ve: vs + verb.length, verb, noun, fix });
  }
  // overlapping parses ("policy support growth" vs "support growths"): the hit
  // whose verb is really a noun ("chart" in "chart illustrate") is the
  // misparse and goes; otherwise the left hit owns the verb ("support").
  const drop = new Set();
  for (const h of hits) {
    const o = hits.find((x) => x !== h && x.ns === h.vs);
    if (!o) continue;
    drop.add(SINGULAR_NOUNS.has(h.verb.toLowerCase()) ? h : o);
  }
  for (const h of hits) {
    if (drop.has(h)) continue;
    pushGrammar(errs, 'grammar', h.vs, h.ve, h.verb, `Use '${h.fix}' with '${h.noun}'`, [h.fix]);
  }
  // 2f. "to be" agreement, plural subject + is/was -> are/were.
  // ("ideas is important" -> "are"). they/we/you stay with rule 2.
  const bePlurRe = /\b([a-z]+)\s+(is|was)\b/gi;
  while ((m = bePlurRe.exec(text))) {
    if (/^(they|we|you|this|that|it|she|he)$/i.test(m[1])) continue;
    if (!isPluralNoun(m[1], knownWord)) continue;
    const fix = m[2].toLowerCase() === 'is' ? 'are' : 'were';
    const vs = m.index + m[0].length - m[2].length;
    pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2], `Use '${fix}' with '${m[1]}'`, [fix]);
  }
  // 2g. "to be" agreement, singular subject + are/were/am -> is/was.
  // ("The dog are friendly" -> "is", "She were" -> "was")
  const beSingRe = /\b(she|he|it|this|that)\s+(are|were|am)\b/gi;
  while ((m = beSingRe.exec(text))) {
    const fix = m[2].toLowerCase() === 'were' ? 'was' : 'is';
    const vs = m.index + m[0].length - m[2].length;
    pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2], `Use '${fix}' with '${m[1]}'`, [fix]);
  }
  const beNounRe = new RegExp(`\\b(${SING_LIST})\\s+(are|were)\\b`, 'gi');
  while ((m = beNounRe.exec(text))) {
    const fix = m[2].toLowerCase() === 'were' ? 'was' : 'is';
    const vs = m.index + m[0].length - m[2].length;
    pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2], `Use '${fix}' with '${m[1]}'`, [fix]);
  }
  // 2h. existential "there/here is/was" + plural noun -> are/were.
  // ("There is many reasons" -> "are")
  const existRe = /\b(there|here)\s+(is|was)\s+((?:[a-z]+\s+){0,3}?)([a-z]+s)\b/gi;
  while ((m = existRe.exec(text))) {
    const noun = m[4];
    if (!isPluralNoun(noun, knownWord)) continue;
    if (VERB_BASES.has(noun.toLowerCase())) continue; // "there is much rains"? no — verb, not noun
    const fix = m[2].toLowerCase() === 'is' ? 'are' : 'were';
    const vs = m.index + m[1].length + 1;
    pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2], `Use '${fix}' with '${m[1]}'`, [fix]);
  }
  // I + verb-s -> base ("I goes" -> "go", "I has" -> "have").
  // Be-forms handled separately: "I is/are" -> "am"; was/were left alone
  // ("I was" is correct, "if I were" is subjunctive).
  const iRe = /\bi\s+([a-z]+)(?!')\b/gi;
  while ((m = iRe.exec(text))) {
    const w = m[1].toLowerCase();
    const vs = m.index + m[0].length - m[1].length;
    if (/^(is|are)$/.test(w)) {
      pushGrammar(errs, 'grammar', vs, vs + m[1].length, m[1], `Use 'am' with 'I'`, ['am']);
      continue;
    }
    if (/^(am|was|were|be|been|being)$/.test(w)) continue;
    if (!w.endsWith('s')) continue;
    const base = baseOfS(w, knownWord);
    if (base) {
      pushGrammar(errs, 'grammar', vs, vs + m[1].length, m[1], `Use '${base}' with 'I'`, [base]);
    }
  }

  // 3. a/an agreement
  const aRe = /\b(a|an)\s+([a-zA-Z][a-zA-Z'-]*)/g;
  while ((m = aRe.exec(text))) {
    const art = m[1];
    const next = m[2];
    const vowelSound = 'aeiou'.includes(next[0].toLowerCase()) || AN_EXCEPTIONS.has(next.toLowerCase());
    if (art.toLowerCase() === 'a' && vowelSound) {
      pushGrammar(errs, 'grammar', m.index, m.index + 1, m[1],
        `Use 'an' before '${next}'`, [art === 'A' ? 'An' : 'an']);
    } else if (art.toLowerCase() === 'an' && !vowelSound) {
      pushGrammar(errs, 'grammar', m.index, m.index + 2, m[1],
        `Use 'a' before '${next}'`, [art === 'An' ? 'A' : 'a']);
    }
  }

  // 4. repeated word ("the the")
  const repRe = /\b([a-zA-Z]+)\s+\1\b/gi;
  while ((m = repRe.exec(text))) {
    pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0], 'Repeated word', [m[1]]);
  }

  // 5. common confusions
  const confRe = /\b(your)\s+(going|coming|doing|welcome|right|wrong|the best)\b/gi;
  while ((m = confRe.exec(text)))
    pushGrammar(errs, 'grammar', m.index, m.index + m[1].length, m[1], 'Did you mean "you\'re"?', ["you're"]);
  const theirRe = /\b(their)\s+(is|are|was|were)\b/gi;
  while ((m = theirRe.exec(text)))
    pushGrammar(errs, 'grammar', m.index, m.index + m[1].length, m[1], 'Did you mean "there"?', ['there']);
  const ofRe = /\b(could|would|should|must|might)\s+(of)\b/gi;
  while ((m = ofRe.exec(text))) {
    const vs = m.index + m[1].length + 1;
    pushGrammar(errs, 'grammar', vs, vs + 2, m[2], `Use 'have' after '${m[1]}'`, ['have']);
  }
  const thenRe = /\b(better|more|less|rather|other)\s+(then)\b/gi;
  while ((m = thenRe.exec(text))) {
    const vs = m.index + m[1].length + 1;
    pushGrammar(errs, 'grammar', vs, vs + 4, m[2], 'Did you mean "than"?', ['than']);
  }
  const itsRe = /\b(its)\s+(is|are|was|were|not|so|very|too|been)\b/gi;
  while ((m = itsRe.exec(text)))
    pushGrammar(errs, 'grammar', m.index, m.index + 3, m[1], 'Did you mean "it\'s"?', ["it's"]);

  // 5b. age expressions: preposition + article collocation ("in young age" ->
  // "at a young age", "at young age" -> "at a young age", "they young age" ->
  // "a young age"). Powerful for IELTS-style "young age" sentences.
  {
    const AGE_ADJ = 'young|early|old|tender|teenage';
    // (i) subject/object pronoun where an article belongs: "they young age"
    // Possessives (their/his/her/...) are grammatical — never flagged.
    const pronAgeRe = new RegExp(`\\b(they|them|we|us|he|him|she|you|I)\\s+(${AGE_ADJ})\\s+(age)\\b`, 'gi');
    while ((m = pronAgeRe.exec(text))) {
      const adj = m[2], age = m[3];
      const art = /^[A-Z]/.test(m[1]) ? 'A' : 'a';
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Use '${art}' before '${adj} ${age}'`, [`${art} ${adj} ${age}`]);
    }
    // (ii) preposition (+ optional "the") + bare age: "in young age",
    // "on young age", "at young age", "in the young age" -> "at a young age".
    // "at they young age" is owned by (i) above (pronoun blocks this match).
    // "at the young age of 5" is specific — skipped via the of-guard.
    const prepAgeRe = new RegExp(`\\b(in|on|at)\\s+(?:(the)\\s+)?(${AGE_ADJ})\\s+(age)\\b(?!\\s+of\\b)`, 'gi');
    while ((m = prepAgeRe.exec(text))) {
      const prep = m[1], adj = m[3], age = m[4];
      const atWord = /^[A-Z]/.test(prep) ? 'At' : 'at';
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Use 'at a ${adj} ${age}'`, [`${atWord} a ${adj} ${age}`]);
    }
  }

  // 5c. "skills to people" -> "skills for people" (beneficiary collocation).
  {
    const skillRe = /\b(skills?)\s+(to)\s+(people|persons?|individuals|students|children|workers|employees|learners|teenagers|youth)\b/gi;
    while ((m = skillRe.exec(text))) {
      const vs = m.index + m[1].length + 1;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use 'for' after '${m[1]}'`, ['for']);
    }
  }

  // 5d. resumptive pronoun after a relative clause: "which they can apply
  // them" -> "which they can apply" ("which" already IS the object).
  {
    const resRe = /\b(which|that)\b([^.,;?!]{0,60}?)\b(apply|use|utilize|utilise)\s+(them|it)\b/gi;
    while ((m = resRe.exec(text))) {
      const verb = m[3], pron = m[4];
      const vPos = m.index + m[0].toLowerCase().lastIndexOf((verb + ' ' + pron).toLowerCase());
      pushGrammar(errs, 'grammar', vPos, vPos + verb.length + 1 + pron.length, `${verb} ${pron}`,
        `Remove redundant '${pron}' — '${m[1]}' is already the object`, [verb]);
    }
  }

  // 5e. compound noun spacing: "life style" -> "lifestyle".
  {
    const lifeRe = /\b(life)\s+(style|styles)\b/gi;
    while ((m = lifeRe.exec(text))) {
      const plural = m[2].toLowerCase() === 'styles';
      let fix = plural ? 'lifestyles' : 'lifestyle';
      if (m[1] === m[1].toUpperCase() && m[2] === m[2].toUpperCase()) fix = fix.toUpperCase();
      else if (/^[A-Z]/.test(m[1])) fix = fix[0].toUpperCase() + fix.slice(1);
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Use '${fix.toLowerCase()}' (one word)`, [fix]);
    }
  }

  // 5f. missing determiner before "quality": "increase quality" ->
  // "increase their quality" (plural/people context) or "increase the quality".
  {
    const qualRe = /\b(increase|increases|increased|increasing|improve|improves|improved|improving|enhance|enhances|enhanced|enhancing|boost|boosts|boosted|boosting|raise|raises|raised|raising)\s+(quality)\b/gi;
    while ((m = qualRe.exec(text))) {
      const verb = m[1], noun = m[2];
      const vs = m.index + verb.length + 1;
      const hasPeople = /\b(they|their|them|people|individuals|students|children|workers)\b/i.test(text);
      const det = hasPeople ? (/^[A-Z]/.test(noun) ? 'Their' : 'their') : 'the';
      const alt = hasPeople ? 'the' : 'their';
      const nounKeep = /^[A-Z]/.test(noun) && det === 'the' ? noun.toLowerCase() : noun;
      pushGrammar(errs, 'grammar', vs, vs + noun.length, noun,
        `Add '${det}' before '${noun}'`, [`${det} ${nounKeep}`, `${alt} ${nounKeep}`]);
    }
  }

  // 5g. missing "the" after "of" before a singular workplace noun:
  // "experience of job" -> "experience of the job". Skips generic
  // "type/kind/sort of job" which is fine without an article.
  {
    const ofJobRe = /\b(of)\s+(job|office|company|school|factory|hospital|bank|store|shop|workplace|position|post)\b/gi;
    while ((m = ofJobRe.exec(text))) {
      const noun = m[2];
      const before = text.slice(Math.max(0, m.index - 18), m.index);
      if (/\b(type|kind|sort|form|types|kinds|sorts)\s+$/i.test(before)) continue;
      const vs = m.index + m[0].length - noun.length;
      pushGrammar(errs, 'grammar', vs, vs + noun.length, noun,
        `Add 'the' before '${noun}'`, [`the ${noun}`]);
    }
  }

  // 5h. unnecessary "the" with generic "individuals": "the individuals do
  // not" -> "individuals do not". Narrow to this noun so specific phrases
  // like "the dogs" / "the people" are never touched.
  {
    const indivRe = /\b(the)\s+(individuals)\b/gi;
    while ((m = indivRe.exec(text))) {
      const art = m[1];
      const fix = /^[A-Z]/.test(art) ? 'Individuals' : 'individuals';
      // Specific past-tense reading ("The individuals were interviewed") keeps
      // its "the" — only generic present statements drop it.
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
      if (/^\s+(was|were|been|had|did)\b/i.test(after)) continue;
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Remove unnecessary 'the' before generic plural '${fix.toLowerCase()}'`, [fix]);
    }
  }

  // 5i. pronoun case + reflexives + who/where confusions.
  {
    // lowercase "i" (pronoun is always capital). \bi\b also repairs "i'm".
    const iRe = /\bi\b/g;
    while ((m = iRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + 1, m[0],
        `Use capital 'I' for the pronoun`, ['I']);
    }
    // non-word reflexives: themself/theirselves->themselves, hisself->himself.
    const reflRe = /\b(themself|theirselves|hisself)\b/gi;
    while ((m = reflRe.exec(text))) {
      const fix = /hisself/i.test(m[0]) ? matchCase(m[0], 'himself') : matchCase(m[0], 'themselves');
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Use '${fix.toLowerCase()}'`, [fix]);
    }
    // sentence-start "Me and John went" -> "I and John went".
    const meAndRe = /^\s*(me)\s+(and)\b/i;
    if ((m = meAndRe.exec(text))) {
      const vs = m.index + m[0].length - m[2].length - 1 - (m[1].length - 1) - 1;
      void vs;
      const wStart = m.index + m[0].indexOf(m[1]);
      pushGrammar(errs, 'grammar', wStart, wStart + m[1].length, m[1],
        `Use 'I' as the subject`, [matchCase(m[1], 'I')]);
    }
    // object of preposition: "between/for/with you and I" -> "me".
    const prepIRe = /\b(for|with|to|from|between|of|about|by|without)\s+[a-z]+\s+and\s+(I)\b/gi;
    while ((m = prepIRe.exec(text))) {
      const vs = m.index + m[0].length - 1;
      pushGrammar(errs, 'grammar', vs, vs + 1, m[2],
        `Use 'me' after a preposition`, ['me']);
    }
    // "John and myself went/are/have..." (subject) -> "John and I".
    const myselfSubRe = /\band\s+(myself)\s+(are|were|have|will|would|can|could|shall|should|may|might|must|go|went|have)\b/gi;
    while ((m = myselfSubRe.exec(text))) {
      const vs = m.index + 4;
      pushGrammar(errs, 'grammar', vs, vs + m[1].length, m[1],
        `Use 'I' as the subject`, ['I']);
    }
    // "to John and myself" (object) -> "me".
    const myselfObjRe = /\b(for|with|to|from|between|of|about|by)\s+[a-z]+\s+and\s+(myself)\b/gi;
    while ((m = myselfObjRe.exec(text))) {
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use 'me' as the object`, ['me']);
    }
    // "their/their going" -> "they're going" (progressive needs they+are).
    const progList = 'going|coming|doing|being|having|making|taking|getting|saying|leaving';
    const theirProgRe = new RegExp(`\\b(their|there)\\s+(${progList})\\b`, 'gi');
    while ((m = theirProgRe.exec(text))) {
      const fix = matchCase(m[1], "they're");
      pushGrammar(errs, 'grammar', m.index, m.index + m[1].length, m[1],
        `Did you mean "${fix}"?`, [fix]);
    }
    // "they where happy" -> "they were happy" (subject-aware was/were).
    const wherePlurRe = /\b(they|we|you)\s+(where)\b/gi;
    while ((m = wherePlurRe.exec(text))) {
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Did you mean "were"?`, ['were']);
    }
    const whereSingRe = /\b(I|he|she|it)\s+(where)\b/gi;
    while ((m = whereSingRe.exec(text))) {
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Did you mean "was"?`, ['was']);
    }
    // "the whether" -> "the weather".
    const whetherRe = /\bthe\s+(whether)\b/gi;
    while ((m = whetherRe.exec(text))) {
      const vs = m.index + m[0].length - m[1].length;
      const fix = matchCase(m[1], 'weather');
      pushGrammar(errs, 'grammar', vs, vs + m[1].length, m[1],
        `Did you mean "weather"?`, [fix]);
    }
  }

  // 5j. auxiliaries, modals, infinitives, perfect tenses.
  {
    // "he don't" -> "he doesn't".
    const dontRe = /\b(he|she|it)\s+(don't)\b/gi;
    while ((m = dontRe.exec(text))) {
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use 'doesn't' with '${m[1]}'`, [matchCase(m[2], "doesn't")]);
    }
    // "they doesn't" -> "they don't".
    const doesntRe = /\b(they|we|you|I)\s+(doesn't)\b/gi;
    while ((m = doesntRe.exec(text))) {
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use 'don't' with '${m[1]}'`, [matchCase(m[2], "don't")]);
    }
    // modal + verb-s: "can goes" -> "can go".
    const modalSRe = /\b(can|could|will|would|shall|should|may|might|must)\s+([A-Za-z]+s)(?!')\b/gi;
    while ((m = modalSRe.exec(text))) {
      const lw = m[2].toLowerCase();
      const base = HAVE_FIX[lw] || baseOfS(lw, knownWord);
      if (!base || !VERB_BASES.has(base)) continue;
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use base form '${base}' after '${m[1]}'`, [matchCase(m[2], base)]);
    }
    // modal + irregular past: "will went" -> "will go".
    const modalPastRe = /\b(can|could|will|would|shall|should|may|might|must)\s+(went|came|saw|ate|wrote|spoke|took|got|did|had|made|said|thought|brought|bought|caught|chose|forgot)\b/gi;
    while ((m = modalPastRe.exec(text))) {
      const base = PAST_TO_BASE[m[2].toLowerCase()];
      if (!base) continue;
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use base form '${base}' after '${m[1]}'`, [matchCase(m[2], base)]);
    }
    // modal + "to go" ("can to go" -> "can go").
    const modalToRe = /\b(can|could|will|would|shall|should|may|might|must)\s+(to)\s+([a-z]+)\b/gi;
    while ((m = modalToRe.exec(text))) {
      if (!VERB_BASES.has(m[3].toLowerCase()) && !knownWord(m[3].toLowerCase())) continue;
      let rep = m[3];
      const lw3 = m[3].toLowerCase();
      const b3 = HAVE_FIX[lw3] || baseOfS(lw3, knownWord) || PAST_TO_BASE[lw3];
      if (b3 && (VERB_BASES.has(b3))) rep = matchCase(m[3], b3);
      const vs = m.index + m[1].length + 1;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length + 1 + m[3].length, `${m[2]} ${m[3]}`,
        `Remove 'to' after '${m[1]}'`, [rep]);
    }
    // infinitive + verb-s: "to goes" -> "to go" (verb-gated, so "to schools" stays).
    const toSRe = /\bto\s+([A-Za-z]+s)(?!')\b/gi;
    while ((m = toSRe.exec(text))) {
      const lw = m[1].toLowerCase();
      const base = HAVE_FIX[lw] || baseOfS(lw, knownWord);
      if (!base || !VERB_BASES.has(base)) continue;
      const vs = m.index + 3;
      pushGrammar(errs, 'grammar', vs, vs + m[1].length, m[1],
        `Use base form '${base}' after 'to'`, [matchCase(m[1], base)]);
    }
    // "did walked/went" -> "did walk/go".
    const didEdRe = /\bdid\s+([A-Za-z]+ed|went|came|saw|ate|wrote|spoke|took|got|had|made|said|thought|brought|bought|caught|chose|forgot)\b/gi;
    while ((m = didEdRe.exec(text))) {
      const lw = m[1].toLowerCase();
      const base = PAST_TO_BASE[lw] || baseOfEd(lw, knownWord);
      if (!base) continue;
      const vs = m.index + 4;
      pushGrammar(errs, 'grammar', vs, vs + m[1].length, m[1],
        `Use base form '${base}' after 'did'`, [matchCase(m[1], base)]);
    }
    // perfect tense: "have went/saw" -> "have gone/seen".
    const perfRe = /\b(have|has|had)\s+(went|came|saw|ate|wrote|spoke|took|did)\b/gi;
    while ((m = perfRe.exec(text))) {
      const part = PAST_TO_PART[m[2].toLowerCase()];
      if (!part) continue;
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use '${part}' after '${m[1]}'`, [matchCase(m[2], part)]);
    }
    // "I am agree / he is agree / they are agree" + belong/consist/comprise.
    const beAgreeRe = /\b(am|is|are)\s+(agree|disagree|belong)\b/gi;
    while ((m = beAgreeRe.exec(text))) {
      const be = m[1].toLowerCase(), vb = m[2].toLowerCase();
      let rep;
      if (be === 'is') rep = vb === 'agree' ? 'agrees' : vb === 'disagree' ? 'disagrees' : 'belongs';
      else rep = vb;
      const vs = m.index;
      pushGrammar(errs, 'grammar', vs, vs + m[0].length, m[0],
        `Use '${rep}' without '${m[1]}'`, [matchCase(m[1], rep)]);
    }
    const beConsistRe = /\b(am|is|are)\s+(consist|comprise)\s+(of)\b/gi;
    while ((m = beConsistRe.exec(text))) {
      const be = m[1].toLowerCase(), vb = m[2].toLowerCase();
      let rep;
      if (vb === 'consist') rep = be === 'is' ? 'consists of' : 'consist of';
      else rep = be === 'is' ? 'comprises' : 'comprise';
      const alts = vb === 'comprise' && be === 'is' ? [rep, `${m[1]} comprised of`] : [rep];
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Use '${rep}'`, alts);
    }
    // "each of them are" / "one of the reasons are" -> "is".
    const eachAreRe = /\b(each)\s+of\s+(them|us|you)\s+(are)\b/gi;
    while ((m = eachAreRe.exec(text))) {
      const vs = m.index + m[0].length - m[3].length;
      pushGrammar(errs, 'grammar', vs, vs + m[3].length, m[3],
        `Use 'is' with 'each'`, ['is']);
    }
    const oneAreRe = /\b(one)\s+of\s+(?:the\s+)?[a-z]+\s+(are)\b/gi;
    while ((m = oneAreRe.exec(text))) {
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use 'is' with 'one'`, ['is']);
    }
    // "police is/was" -> "police are/were".
    const policeRe = /\b(police)\s+(is|was)\b/gi;
    while ((m = policeRe.exec(text))) {
      const fix = m[2].toLowerCase() === 'is' ? 'are' : 'were';
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use '${fix}' with 'police'`, [fix]);
    }
  }

  // 5k. determiners + quantifiers + number agreement.
  {
    // "much reasons" -> "many reasons".
    const muchRe = /\bmuch\s+([A-Za-z]+)\b/gi;
    while ((m = muchRe.exec(text))) {
      if (!isPluralNoun(m[1], knownWord)) continue;
      pushGrammar(errs, 'grammar', m.index, m.index + 4, m[0].slice(0, 4),
        `Use 'many' with plural nouns`, [matchCase(m[0].slice(0, 4), 'many')]);
    }
    // "many book" -> "many books".
    const manyOneRe = /\b(many)\s+([A-Za-z]+)\b/gi;
    while ((m = manyOneRe.exec(text))) {
      if (isPluralNoun(m[2], knownWord)) continue;
      const pl = pluralOf(m[2].toLowerCase(), knownWord);
      if (!pl) continue;
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use plural '${pl}' after 'many'`, [matchCase(m[2], pl)]);
    }
    // "less reasons" -> "fewer reasons".
    const lessRe = /\bless\s+([A-Za-z]+)\b/gi;
    while ((m = lessRe.exec(text))) {
      if (!isPluralNoun(m[1], knownWord)) continue;
      pushGrammar(errs, 'grammar', m.index, m.index + 4, m[0].slice(0, 4),
        `Use 'fewer' with plural nouns`, [matchCase(m[0].slice(0, 4), 'fewer')]);
    }
    // "each/every/one reason(s)": plural -> singular ("each reasons" -> "each reason").
    const eachPlurRe = /\b(each|every|one)\s+([A-Za-z]+)\b/gi;
    while ((m = eachPlurRe.exec(text))) {
      if (!isPluralNoun(m[2], knownWord)) continue;
      const sing = singularOfPlural(m[2].toLowerCase(), knownWord);
      if (!sing) continue;
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use singular '${sing}' after '${m[1]}'`, [matchCase(m[2], sing)]);
    }
    // "these/those book" -> "these/those books".
    const demSingRe = /\b(these|those)\s+([A-Za-z]+)\b/gi;
    while ((m = demSingRe.exec(text))) {
      if (isPluralNoun(m[2], knownWord)) continue;
      const pl = pluralOf(m[2].toLowerCase(), knownWord);
      if (!pl) continue;
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use plural '${pl}' after '${m[1]}'`, [matchCase(m[2], pl)]);
    }
    // "this/that books" -> "these/those books".
    const demPlurRe = /\b(this|that)\s+([A-Za-z]+)\b/gi;
    while ((m = demPlurRe.exec(text))) {
      if (!isPluralNoun(m[2], knownWord)) continue;
      const fix = m[1].toLowerCase() === 'this' ? 'these' : 'those';
      pushGrammar(errs, 'grammar', m.index, m.index + m[1].length, m[1],
        `Use '${fix}' with plural nouns`, [matchCase(m[1], fix)]);
    }
    // "a books" -> "a book".
    const aPlurRe = /\b(a|an)\s+([A-Za-z]+)\b/gi;
    while ((m = aPlurRe.exec(text))) {
      if (!isPluralNoun(m[2], knownWord)) continue;
      const sing = singularOfPlural(m[2].toLowerCase(), knownWord);
      if (!sing) continue;
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use singular '${sing}' after '${m[1]}'`, [matchCase(m[2], sing)]);
    }
  }

  // 5l. word-form errors: mass nouns, wrong plurals, doubles, compounds.
  {
    // mass nouns are never plural: "advices" -> "advice".
    const uncRe = /\b(advices|informations|furnitures|equipments|knowledges|luggages|traffics|homeworks|datas|evidences)\b/gi;
    while ((m = uncRe.exec(text))) {
      const fix = UNCOUNT_FIX[m[0].toLowerCase()];
      if (!fix) continue;
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `'${m[0]}' is not countable — use '${fix}'`, [matchCase(m[0], fix)]);
    }
    // irregular plurals: "childs" -> "children".
    const irregRe = /\b(childs|womans|tooths|foots|sheeps|deers|oxes|criterias|phenomenas|bacterias)\b/gi;
    while ((m = irregRe.exec(text))) {
      const fix = IRREG_PLURAL_FIX[m[0].toLowerCase()];
      if (!fix) continue;
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Use '${fix}'`, [matchCase(m[0], fix)]);
    }
    // double comparative/superlative: "more better" -> "better".
    const moreRe = /\bmore\s+(better|worse|best|worst|bigger|smaller|taller|shorter|faster|slower|higher|lower|larger|easier|happier|simpler|newer|older)\b/gi;
    while ((m = moreRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Remove redundant 'more'`, [m[1]]);
    }
    const mostRe = /\bmost\s+(best|worst|biggest|smallest|tallest|shortest|fastest|slowest|highest|lowest|largest|easiest|happiest|simplest|newest|oldest)\b/gi;
    while ((m = mostRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Remove redundant 'most'`, [m[1]]);
    }
    // fused spellings: "alot" -> "a lot".
    const fusedMap = { alot: 'a lot', aswell: 'as well', infront: 'in front', incase: 'in case', infact: 'in fact', atleast: 'at least', nomatter: 'no matter', ofcourse: 'of course' };
    const fusedRe = /\b(alot|aswell|infront|incase|infact|atleast|nomatter|ofcourse)\b/gi;
    while ((m = fusedRe.exec(text))) {
      const fix = fusedMap[m[0].toLowerCase()];
      if (!fix) continue;
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Write '${fix}' as two words`, [matchCase(m[0], fix)]);
    }
    // "go there everyday." -> "every day" (adverbial); "everyday life" stays.
    const everydayRe = /\b(everyday)\b(?=\s*[.,;?!]|$)/gi;
    while ((m = everydayRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Use 'every day' for frequency`, [matchCase(m[0], 'every day')]);
    }
    const everydayAdjRe = /\bevery\s+day\s+(life|lives|clothes|language|activity|activities|use|routine|essentials)\b/gi;
    while ((m = everydayAdjRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Use 'everyday' before a noun`, [`${matchCase(m[0].split(/\s+/)[0], 'everyday')} ${m[1]}`]);
    }
    // "loose weight" -> "lose weight".
    const looseRe = /\b(loose)\s+(weight|job|game|match|money|keys|phone|bag|wallet)\b/gi;
    while ((m = looseRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + m[1].length, m[1],
        `Did you mean "lose"?`, [matchCase(m[1], 'lose')]);
    }
    // "an affect on" -> "an effect on".
    const affectRe = /\ban\s+(affect)\s+on\b/gi;
    while ((m = affectRe.exec(text))) {
      const vs = m.index + 3;
      pushGrammar(errs, 'grammar', vs, vs + m[1].length, m[1],
        `Did you mean "effect" (noun)?`, [matchCase(m[1], 'effect')]);
    }
    // "quite place" -> "quiet place" (quite can't modify a noun).
    const quiteRe = /\bquite\s+([A-Za-z]+)\b/gi;
    while ((m = quiteRe.exec(text))) {
      if (!isSubjectNoun(m[1], knownWord)) continue;
      if (isPluralNoun(m[1], knownWord)) continue;
      pushGrammar(errs, 'grammar', m.index, m.index + 5, m[0].slice(0, 5),
        `Did you mean "quiet"?`, [matchCase(m[0].slice(0, 5), 'quiet')]);
    }
    // "quiet good" -> "quite good" (quiet can't modify an adjective).
    const quietRe = /\bquiet\s+([A-Za-z]+)\b/gi;
    while ((m = quietRe.exec(text))) {
      if (!ADJECTIVES.has(m[1].toLowerCase())) continue;
      pushGrammar(errs, 'grammar', m.index, m.index + 5, m[0].slice(0, 5),
        `Did you mean "quite"?`, [matchCase(m[0].slice(0, 5), 'quite')]);
    }
  }

  // 5m. verb complements: gerund vs to-infinitive.
  {
    // "enjoy to go" -> "enjoy going".
    const gerRe = new RegExp(`\\b((?:${[...GERUND_VERBS].flatMap((v) => [v, sForm(v)]).join('|')}))\\s+to\\s+([a-z]+)\\b`, 'gi');
    while ((m = gerRe.exec(text))) {
      const gv = m[1].toLowerCase();
      if (!verbInSet(gv, GERUND_VERBS)) continue;
      const ger = gerundOf(m[2].toLowerCase(), knownWord);
      if (!ger) continue;
      const vs = m.index + m[1].length + 1;
      pushGrammar(errs, 'grammar', vs, vs + 2 + 1 + m[2].length, `to ${m[2]}`,
        `Use '${ger}' after '${gv}'`, [matchCase(m[2], ger)]);
    }
    // "want to going" -> "want to go".
    const toingRe = new RegExp(`\\b((?:${[...TOINF_VERBS].flatMap((v) => [v, sForm(v)]).join('|')}))\\s+to\\s+([a-z]+ing)\\b`, 'gi');
    while ((m = toingRe.exec(text))) {
      const tv = m[1].toLowerCase();
      if (!verbInSet(tv, TOINF_VERBS)) continue;
      const base = baseOfIng(m[2].toLowerCase(), knownWord);
      if (!base) continue;
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use base form '${base}' after 'to'`, [matchCase(m[2], base)]);
    }
    // "look forward to hear" -> "look forward to hearing".
    const lookRe = /\b(look|looking)\s+forward\s+to\s+([a-z]+)\b/gi;
    while ((m = lookRe.exec(text))) {
      if (/ing$/i.test(m[2])) continue;
      const ger = gerundOf(m[2].toLowerCase(), knownWord);
      if (!ger) continue;
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use '${ger}' after 'look forward to'`, [matchCase(m[2], ger)]);
    }
    // "used to going" -> "used to go" (but "am used to working" is correct).
    const usedRe = /\bused\s+to\s+([a-z]+ing)\b/gi;
    while ((m = usedRe.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 14), m.index);
      if (/\b(am|is|are|was|were|been|be|get|gets|got|getting)\s+$/i.test(before)) continue;
      const base = baseOfIng(m[1].toLowerCase(), knownWord);
      if (!base) continue;
      const vs = m.index + m[0].length - m[1].length;
      pushGrammar(errs, 'grammar', vs, vs + m[1].length, m[1],
        `Use base form '${base}' after 'used to'`, [matchCase(m[1], base)]);
    }
  }

  // 5n. prepositions + fixed collocations.
  {
    // "in morning" -> "in the morning".
    const mornRe = /\bin\s+(morning|afternoon|evening)\b/gi;
    while ((m = mornRe.exec(text))) {
      const vs = m.index + 3;
      pushGrammar(errs, 'grammar', vs, vs + m[1].length, m[1],
        `Use 'the ${m[1].toLowerCase()}'`, [`the ${m[1]}`]);
    }
    // "on weekend" -> "on the weekend".
    const wkndRe = /\bon\s+(weekend)\b/gi;
    while ((m = wkndRe.exec(text))) {
      const vs = m.index + 3;
      pushGrammar(errs, 'grammar', vs, vs + m[1].length, m[1],
        `Use 'the weekend'`, [`the ${m[1]}`]);
    }
    // "married with" -> "married to".
    const marrRe = /\bmarried\s+(with)\b/gi;
    while ((m = marrRe.exec(text))) {
      const vs = m.index + m[0].length - m[1].length;
      pushGrammar(errs, 'grammar', vs, vs + m[1].length, m[1],
        `Use 'married to'`, ['to']);
    }
    // "depend of/from" -> "depend on".
    const depRe = /\b(depend|depends|depended|depending)\s+(of|from|to)\b/gi;
    while ((m = depRe.exec(text))) {
      const vs = m.index + m[0].length - m[2].length;
      pushGrammar(errs, 'grammar', vs, vs + m[2].length, m[2],
        `Use 'on' with '${m[1]}'`, ['on']);
    }
    // "interested on/for" -> "interested in".
    const intRe = /\binterested\s+(on|for)\b/gi;
    while ((m = intRe.exec(text))) {
      const vs = m.index + m[0].length - m[1].length;
      pushGrammar(errs, 'grammar', vs, vs + m[1].length, m[1],
        `Use 'interested in'`, ['in']);
    }
    // "listen me/music" -> "listen to me/music".
    const listenRe = /\blisten\s+(me|him|her|us|them|music|radio|songs?)\b(?!\s+to\b)/gi;
    while ((m = listenRe.exec(text))) {
      const vs = m.index + 7;
      pushGrammar(errs, 'grammar', vs, vs + m[1].length, m[1],
        `Use 'listen to ${m[1]}'`, [`to ${m[1]}`]);
    }
    // "arrive to" -> "arrive at".
    const arrRe = /\barrive\s+(to)\b/gi;
    while ((m = arrRe.exec(text))) {
      const vs = m.index + m[0].length - 2;
      pushGrammar(errs, 'grammar', vs, vs + 2, m[1],
        `Use 'arrive at'`, ['at', 'in']);
    }
    // "discuss about" -> "discuss".
    const discRe = /\b(discuss|discusses|discussed|discussing)\s+(about)\b/gi;
    while ((m = discRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `'${m[1]}' takes no 'about'`, [m[1]]);
    }
    // redundant pairs: "return back" -> "return", "repeat again" -> "repeat".
    const redRe = /\b(return|returns|returned|returning)\s+(back)\b|\b(repeat|repeats|repeated|repeating)\s+(again)\b|\b(combine|combines|combined|combining|join|joins|joined|joining|merge|merges|merged|merging)\s+(together)\b|\b(revert|reverts|reverted|reverting)\s+(back)\b/gi;
    while ((m = redRe.exec(text))) {
      const verb = m[1] || m[3] || m[5] || m[7];
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Remove redundant '${m[0].split(/\s+/)[1]}'`, [verb]);
    }
    // "despite of" -> "despite"; "inspite of" -> "in spite of".
    const despRe = /\bdespite\s+of\b/gi;
    while ((m = despRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `'despite' takes no 'of'`, [matchCase(m[0].split(/\s+/)[0], 'despite')]);
    }
    // NOTE: zero-width deletion has no clickable fix, so replace the phrase.
    const inspiteOfRe = /\b(inspite)\s+(of)\b/gi;
    while ((m = inspiteOfRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Use 'in spite of'`, [matchCase(m[1], 'in spite') + ' of']);
    }
    const inspiteRe = /\binspite\b(?!\s+of\b)/gi;
    while ((m = inspiteRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Use 'in spite'`, [matchCase(m[0], 'in spite')]);
    }
    // opinion phrases.
    const accRe = /\baccording\s+to\s+me\b/gi;
    while ((m = accRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Use 'in my opinion'`, [matchCase(m[0].split(/\s+/)[0], 'in my opinion')]);
    }
    const povRe = /\bin\s+my\s+point\s+of\s+view\b/gi;
    while ((m = povRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Use 'from my point of view'`, [matchCase(m[0].split(/\s+/)[0], 'from') + ' my point of view']);
    }
    const onOpRe = /\bon\s+my\s+opinion\b/gi;
    while ((m = onOpRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + 2, m[0].slice(0, 2),
        `Use 'in my opinion'`, [matchCase(m[0].slice(0, 2), 'in')]);
    }
    const handRe = /\bin\s+the\s+other\s+hand\b/gi;
    while ((m = handRe.exec(text))) {
      pushGrammar(errs, 'grammar', m.index, m.index + 2, m[0].slice(0, 2),
        `Use 'on the other hand'`, [matchCase(m[0].slice(0, 2), 'on')]);
    }
    // "do a mistake" -> "make a mistake" (tense-matched).
    const mistRe = /\b(do|does|did|doing)\s+(a\s+)?(mistake|mistakes)\b/gi;
    while ((m = mistRe.exec(text))) {
      const fixV = { do: 'make', does: 'makes', did: 'made', doing: 'making' }[m[1].toLowerCase()];
      if (!fixV) continue;
      const art = m[2] || (m[3].toLowerCase() === 'mistake' ? 'a ' : '');
      pushGrammar(errs, 'grammar', m.index, m.index + m[0].length, m[0],
        `Use '${fixV} ${art}${m[3]}'`, [`${matchCase(m[1], fixV)} ${art}${m[3]}`.replace(/\s+/g, ' ')]);
    }
    // "take a look on" -> "take a look at".
    const lookAtRe = /\btake\s+a\s+look\s+(on)\b/gi;
    while ((m = lookAtRe.exec(text))) {
      const vs = m.index + m[0].length - 2;
      pushGrammar(errs, 'grammar', vs, vs + 2, m[1],
        `Use 'take a look at'`, ['at']);
    }
    // "play vital role" -> "play a vital role" (singular only; plural needs none).
    const roleRe = /\b(play|plays|played|playing)\s+(vital|important|key|major|crucial|significant|central)\s+(role|part)\b/gi;
    while ((m = roleRe.exec(text))) {
      const adj = m[2];
      const det = /^[aeiou]/i.test(adj) ? 'an' : 'a';
      const vs = m.index + m[1].length + 1;
      pushGrammar(errs, 'grammar', vs, vs + adj.length, adj,
        `Add '${det}' before '${adj}'`, [`${det} ${adj}`]);
    }
    // "good in English" -> "good at English" (skill list only).
    const goodAtRe = /\bgood\s+(in)\s+(English|math|maths|science|sports|music|cooking|writing|reading|drawing|swimming)\b/gi;
    while ((m = goodAtRe.exec(text))) {
      const vs = m.index + 5;
      pushGrammar(errs, 'grammar', vs, vs + 2, m[1],
        `Use 'good at ${m[2]}'`, ['at']);
    }
  }

  // 5o. comma after sentence-start connectors ("However he is right." ->
  // "However, he is right."). Zero-width redirector (blue, clickable marker).
  {
    const introRe = /^\s*((?:However|Therefore|Moreover|Furthermore|Nevertheless|Meanwhile|In addition|In conclusion|In my opinion|As a result|For example|For instance|On the other hand|To sum up|In other words|By contrast|In contrast))\s+(?=[a-z])/i;
    const im = introRe.exec(text);
    if (im) {
      const ins = im.index + im[1].length;
      pushGrammar(errs, 'grammar', ins, ins, '', 'Add a comma after the intro phrase', [','], { insertText: ',' });
    }
  }

  // ---- punctuation (blue, PLAN section 2) ----
  // 6. space before punctuation / missing space after
  const spRe = / +([,.!?;:])/g;
  while ((m = spRe.exec(text)))
    pushGrammar(errs, 'punctuation', m.index, m.index + m[0].length, m[0],
      'Remove the space before punctuation', [m[1]]);
  const nsRe = /([,.!?;:])([A-Za-z])/g;
  while ((m = nsRe.exec(text))) {
    if (m[1] === '.' && /[A-Za-z]\.[A-Za-z]/.test(m[0])) continue; // e.g. abbreviations/urls
    pushGrammar(errs, 'punctuation', m.index, m.index + 2, m[0],
      'Add a space after punctuation', [`${m[1]} ${m[2]}`]);
  }
  // 7. sentence-start capitalization
  const capM = /^[ \t"“'(\[]*([a-z])/.exec(text);
  if (capM) {
    const idx = capM[0].length - 1;
    pushGrammar(errs, 'grammar', idx, idx + 1, capM[1],
      'Capitalize the start of the sentence', [capM[1].toUpperCase()]);
  }
  // 8. question mark ("Hello how are you" without "?", PLAN example)
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 3 && !/[?.!]\s*$/.test(text.trim())) {
    const qM = /\b(how are you|how is it going|what do you think|are you (ok|okay|sure|coming|going)|do you (like|want|know|think)|can you|could you|would you|will you|is (that|this|it) (ok|okay|right|true)|what time|where are|when (is|are|do|does|will)|why (is|are|do|does|did))\b/i.exec(text);
    if (qM) {
      const end = text.replace(/\s+$/, '').length;
      pushGrammar(errs, 'punctuation', end, end, '',
        'This looks like a question — add a question mark?', ['?'], { appendQuestion: true });
    }
  }
  // dedupe: R1d/R1e can fire on the same span
  const seen = new Set();
  return errs.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

// Result normalizer (PLAN section 10): spelling > grammar > punctuation, drop overlaps.
function normalizeErrors(spellErrs, gramErrs, isIgnored = () => false) {
  const taken = [];
  const overlaps = (s, e) => taken.some(([a, b]) => s < b && e > a);
  const out = [];
  const pri = { spelling: 0, grammar: 1, punctuation: 2 };
  const all = [...spellErrs, ...gramErrs].sort((x, y) => pri[x.type] - pri[y.type] || x.start - y.start);
  for (const e of all) {
    if (isIgnored(e.originalText.toLowerCase())) continue;
    if (overlaps(e.start, e.end)) continue;
    taken.push([e.start, e.end]);
    out.push(e);
  }
  return out.sort((a, b) => a.start - b.start);
}

// PLAN section 6: find only the sentence around the caret.
function currentSentenceRange(text, caret) {
  const bounds = new Set(['.', '!', '?', '\n']);
  let s = caret;
  while (s > 0 && !bounds.has(text[s - 1])) s--;
  let e = caret;
  while (e < text.length && !bounds.has(text[e])) e++;
  if (e < text.length) e++;
  return [s, Math.min(e, text.length)];
}

module.exports = { checkGrammar, normalizeErrors, currentSentenceRange };
