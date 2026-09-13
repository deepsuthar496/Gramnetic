/* Background service worker (bundled to dist/background.bundle.js).
 * Owns ALL checking: loads nspell + dictionary-en from local package files in the
 * extension context (no page CSP can block this), answers RTG_CHECK from tabs.
 * Also owns enabled/custom-dictionary/ignored state.
 */
const nspell = require('nspell');
const { createSpelling } = require('./spelling');
const { activeTokenSpan } = require('./tokens');
const { checkGrammar, normalizeErrors } = require('./grammar');

let enabled = true;
const customSet = new Set();
const ignoredSet = new Set();

let spellInst = null;
let spellApi = null;
let engine = 'loading'; // loading | ready | error
let engineError = '';

async function loadState() {
  const s = await chrome.storage.local.get({ enabled: true, customDict: [], ignored: [] });
  enabled = s.enabled !== false;
  (s.customDict || []).forEach((w) => customSet.add(String(w).toLowerCase()));
  (s.ignored || []).forEach((w) => ignoredSet.add(String(w).toLowerCase()));
}

function addCustomWord(raw) {
  const w = String(raw || '').toLowerCase().trim();
  if (!w) return false;
  customSet.add(w);
  if (spellInst) {
    try { spellInst.add(w); } catch { /* best-effort */ }
    if (spellApi) spellApi.clearCache();
  }
  return true;
}

async function initEngine(retries = 60) {
  try {
    const [aff, dic] = await Promise.all([
      fetch(chrome.runtime.getURL('dist/dict/index.aff')).then((r) => {
        if (!r.ok) throw new Error('aff HTTP ' + r.status);
        return r.text();
      }),
      fetch(chrome.runtime.getURL('dist/dict/index.dic')).then((r) => {
        if (!r.ok) throw new Error('dic HTTP ' + r.status);
        return r.text();
      })
    ]);
    spellInst = nspell(aff, dic);
    [...customSet].forEach((w) => { try { spellInst.add(w); } catch {} });
    spellApi = createSpelling(spellInst, {
      isCustom: (w) => customSet.has(w),
      isIgnored: (w) => ignoredSet.has(w)
    });
    engine = 'ready';
    engineError = '';
  } catch (err) {
    engine = 'error';
    engineError = String((err && err.message) || err);
    if (retries > 0) setTimeout(() => initEngine(retries - 1), 2000);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ enabled: true }, (cur) => {
    chrome.storage.local.set({ enabled: cur.enabled !== false });
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) enabled = changes.enabled.newValue !== false;
  if (changes.customDict) {
    (changes.customDict.newValue || []).forEach((w) => addCustomWord(w));
  }
  if (changes.ignored) {
    ignoredSet.clear();
    (changes.ignored.newValue || []).forEach((w) => ignoredSet.add(String(w).toLowerCase()));
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'RTG_STATUS') {
    sendResponse({ engine, engineError, enabled });
    return true;
  }
  if (msg?.type === 'RTG_SET_ENABLED') {
    enabled = !!msg.enabled;
    chrome.storage.local.set({ enabled }, () => sendResponse({ ok: true, enabled }));
    return true;
  }
  if (msg?.type === 'RTG_ADD_WORD') {
    const ok = addCustomWord(msg.word);
    if (ok) {
      chrome.storage.local.get({ customDict: [] }, ({ customDict }) => {
        const w = String(msg.word).toLowerCase().trim();
        if (!customDict.includes(w)) chrome.storage.local.set({ customDict: [...customDict, w] });
      });
    }
    sendResponse({ ok });
    return true;
  }
  if (msg?.type === 'RTG_CHECK') {
    if (!spellApi || !enabled) {
      sendResponse({ pending: true, reason: !spellApi ? engine : 'disabled' });
      return true;
    }
    try {
      const out = [];
      let total = 0;
      for (const r of msg.ranges || []) {
        const t = typeof r.t === 'string' ? r.t : '';
        if (!t.trim()) continue;
        total += t.length;
        if (total > 6000) break; // sanity cap per message
        // word under the cursor (field focused): still being typed, never flagged
        const relC = (msg.focused && typeof msg.c === 'number') ? msg.c - r.s : null;
        const active = activeTokenSpan(t, relC);
        const overlapsActive = (e) => active && e.start < active.end && e.end > active.start;
        const sp = spellApi.checkSpelling(t, active);
        let gr = checkGrammar(t, spellApi.knownWord).filter((e) => !overlapsActive(e));
        // second pass on the corrected view so grammar sees through typos
        const cv = spellApi.correctText(t, active);
        if (cv.changed) {
          for (const e of checkGrammar(cv.text, spellApi.knownWord)) {
            const [ns, ne] = cv.mapRange(e.start, e.end);
            if (!(ne > ns) && !e.appendQuestion) continue;
            const end = e.appendQuestion ? ns : ne;
            if (overlapsActive({ start: ns, end })) continue;
            gr.push({ ...e, start: ns, end, id: `gr-${ns}-${end}-${t.slice(ns, end)}` });
          }
          const seen = new Set();
          gr = gr.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
        }
        for (const e of [...sp, ...gr]) { e.start += r.s; e.end += r.s; }
        out.push(...normalizeErrors(sp, gr, (w) => ignoredSet.has(w)));
      }
      sendResponse({ errors: out });
    } catch {
      sendResponse({ pending: true, reason: 'exception' });
    }
    return true;
  }
  return false;
});

loadState().then(() => initEngine());
