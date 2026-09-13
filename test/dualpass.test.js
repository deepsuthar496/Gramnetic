// Dual-pass verification: drives the REAL src/background.js RTG_CHECK handler,
// proving grammar fires through misspellings via the corrected view.
// Run: npm test (chained in package.json)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let msgHandler = null;
const store = { enabled: true, customDict: [], ignored: [] };
global.chrome = {
  storage: {
    local: {
      get: (d, cb) => { const r = { ...d, ...store }; return cb ? cb(r) : Promise.resolve(r); },
      set: (o, cb) => { Object.assign(store, o); cb && cb(); }
    },
    onChanged: { addListener() {} }
  },
  runtime: {
    getURL: (p) => p,
    onInstalled: { addListener() {} },
    onMessage: { addListener: (h) => { msgHandler = h; } }
  }
};
global.fetch = async (p) => ({
  ok: true,
  text: async () => fs.readFileSync(path.join(root, String(p).replace(/^[\\/]+/, '')), 'utf8')
});

require('../src/background.js');
const send = (msg) => new Promise((resolve) => msgHandler(msg, {}, resolve));
const fmt = (errors) => (errors || []).map((e) => `${e.type}:${e.originalText}->${(e.suggestions || [])[0] || ''}`);

let failures = 0;
function expectGot(label, got, want) {
  const ok = want.length === got.length && want.every((w, i) => got[i] === w);
  console.log((ok ? 'PASS' : 'FAIL'), label, '=>', JSON.stringify(got));
  if (!ok) { failures++; console.log('     want:', JSON.stringify(want)); }
}

(async () => {
  let st;
  for (let i = 0; i < 50; i++) {
    st = await send({ type: 'RTG_STATUS' });
    if (st.engine === 'ready') break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (st.engine !== 'ready') { console.log('FAIL engine not ready', JSON.stringify(st)); process.exit(1); }
  console.log('PASS engine ready');

  const check = async (text, extra = {}) => {
    const res = await send({ type: 'RTG_CHECK', ranges: [{ s: 0, e: text.length, t: text }], ...extra });
    if (!res || res.pending) throw new Error('check pending: ' + JSON.stringify(res));
    return fmt(res.errors);
  };

  // the user's exact sentence: spelling red + grammar blue on "play"
  expectGot('user sentence', await check('Countrie try to tackle financial crysis as economay play vital role'), [
    'spelling:Countrie->countries',
    'spelling:crysis->crisis',
    'spelling:economay->economy',
    'grammar:play->plays',
    'grammar:vital->a vital'
  ]);
  expectGot('clean', await check('Countries try to tackle financial crisis as economy plays a vital role.'), []);
  expectGot('corrected-view cl5209', await check('Teh dog bark loudly.'), [
    'spelling:Teh->the',
    'grammar:bark->barks'
  ]);
  // active word: caret inside/at end while focused -> skipped; blurred -> checked
  expectGot('mid-word pause, focused', await check('recieve mesage', { c: 4, focused: true }), [
    'spelling:mesage->message'
  ]);
  expectGot('end-of-word pause, focused', await check('recieve mesage', { c: 14, focused: true }), [
    'spelling:recieve->receive'
  ]);
  expectGot('same text, blurred', await check('recieve mesage', { c: 14, focused: false }), [
    'spelling:recieve->receive',
    'spelling:mesage->message'
  ]);
  expectGot('grammar waits for the verb', await check('She go', { c: 6, focused: true }), []);
  expectGot('grammar fires once complete', await check('She go ', { c: 7, focused: true }), [
    'grammar:go->goes'
  ]);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
