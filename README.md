# Gramnetic (Chrome MV3)

Type normally. The extension quietly checks in the background and underlines
problems as they appear. Red wavy = spelling, blue wavy = grammar/punctuation.
Click an underline for Replace / Ignore / Add to dictionary. 100% local.

## Engines

* Spelling: `nspell` + `dictionary-en` (Hunspell-compatible, ~150k words via affix rules)
* Grammar/punctuation: local rule engine in `src/grammar.js`

## Build

```powershell
npm install
npm run build   # -> dist/content.bundle.js + dist/dict/
```

## Install a release build

1. Download `Gramnetic-vX.Y.Z.zip` from [Releases](../../releases)
2. Extract it anywhere
3. `chrome://extensions` -> Developer mode -> Load unpacked -> select the folder

Each release also ships a `Gramnetic-vX.Y.Z.crx`. Note: stock Chrome
blocks direct `.crx` installs outside the Web Store, so the `.zip` +
Load unpacked path above is the supported one. The `.crx` is for
Chromium forks / managed installs.

## Load unpacked

1. `chrome://extensions` -> Developer mode -> Load unpacked
2. Select this folder
3. Open `test.html` (or any site) and type: `I recieved your mesage`, `She go to school`, `Hello how are you`

## Layout

* `src/content.js` — controller: debounce, per-sentence check, overlays, suggestion card
* `src/background.js` — owns checking (nspell + rules) in the worker, answers tabs
* `src/spelling.js` — nspell wrapper (tokenize, skip rules, suggestion ranking)
* `src/grammar.js` — grammar/punctuation rules + result normalizer (pure, tested)
* `src/tokens.js` — shared tokenizer
* `popup.*` — toggle, counts, engine/field status diagnostics

## Troubleshooting

After every `npm run build`: `chrome://extensions` -> reload the extension,
then reload the tab. The popup header shows the version — confirm it reads
the version from `manifest.json`.

* Popup says "checker isn't on this page": reload the tab. `chrome://`,
  Chrome Web Store, and `file://` (without "Allow access to file URLs") block
  content scripts.
* Google Docs draws text on a canvas — underlines can't work there. Works in
  textarea, inputs, and contenteditable editors (Gmail, Outlook, Notion, …).
* `npm test` runs the engine suite (spelling + grammar + no-false-positive guards).
