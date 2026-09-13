// Render test: loads the REAL extension in headless Chrome, types errors into
// textarea + contenteditable, and proves red/blue SOLID underlines actually paint
// (DOM spans + computed style + red/blue pixels in a screenshot).
// Run: npm run test:render
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8931;

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const file = path.join(ROOT, req.url === '/' ? 'test.html' : decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      });
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

// crude PNG-free pixel check: use CDP screenshot -> decode? Instead probe via
// canvas in-page: draw the page? Can't rasterize DOM to canvas (taint).
// Approach: screenshot PNG, parse with a tiny built-in PNG reader (no deps).
function parsePNG(buf) {
  // minimal: only handles 8-bit truecolor+alpha as Chrome writes; use zlib inflate
  const zlib = require('zlib');
  let pos = 8;
  let width, height, bitDepth, colorType;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported PNG ${bitDepth}/${colorType}`);
  const ch = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const px = Buffer.alloc(width * height * ch);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = p;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      let v = raw[row + x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 255;
      }
      px[y * stride + x] = v;
    }
    p += stride;
  }
  return { width, height, ch, px };
}

(async () => {
  const srv = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rtg-prof-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--load-extension=${ROOT}`,
      '--no-first-run', '--no-default-browser-check',
      '--window-size=1280,1000', '--force-device-scale-factor=1',
      `--user-data-dir=${profile}`
    ]
  });
  let failures = 0;
  const verdict = (ok, label, extra = '') => {
    console.log((ok ? 'PASS' : 'FAIL'), label, extra);
    if (!ok) failures++;
  };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${PORT}/test.html`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 2500)); // SW boot + dict load + initial pass

    // 1. type errors into the textarea
    await page.click('textarea');
    await page.keyboard.type('I recieved your mesage and she go home', { delay: 20 });
    await new Promise((r) => setTimeout(r, 2000)); // debounce + bg check + render

    const dom = await page.evaluate(() => {
      const info = {};
      const bd = document.querySelector('.rtg-backdrop');
      info.backdrop = !!bd;
      if (bd) {
        const r = bd.getBoundingClientRect();
        info.rect = { x: r.x, y: r.y, w: r.width, h: r.height };
        info.spans = [...bd.querySelectorAll('[data-err]')].map((s) => {
          const cs = getComputedStyle(s);
          const sr = s.getBoundingClientRect();
          return {
            text: s.textContent, cls: s.className,
            style: cs.textDecorationStyle, color: cs.textDecorationColor, line: cs.textDecorationLine,
            rect: { x: sr.x, y: sr.y, w: sr.width, h: sr.height }
          };
        });
      }
      const ta = document.querySelector('textarea');
      const tr = ta.getBoundingClientRect();
      info.field = { x: tr.x, y: tr.y, w: tr.width, h: tr.height };
      return info;
    });
    verdict(dom.backdrop, 'overlay backdrop created');
    verdict(dom.spans && dom.spans.length >= 3, 'error spans rendered', JSON.stringify((dom.spans || []).map((s) => s.text)));
    const solids = (dom.spans || []).filter((s) => s.style === 'solid' && s.line.includes('underline'));
    verdict(solids.length >= 3, 'underlines are SOLID', JSON.stringify((dom.spans || []).map((s) => s.style + '/' + s.color)));
    const reds = (dom.spans || []).filter((s) => /255,\s*0,\s*0/.test(s.color));
    const blues = (dom.spans || []).filter((s) => /0,\s*0,\s*255/.test(s.color));
    verdict(reds.length >= 2, 'red spelling underlines', reds.map((s) => s.text).join(','));
    verdict(blues.length >= 1, 'blue grammar underlines', blues.map((s) => s.text).join(','));

    // 2. screenshot pixel proof
    const shot = await page.screenshot({ type: 'png' });
    const img = parsePNG(shot);
    let redPx = 0, bluePx = 0;
    const d = img.px, ch = img.ch;
    for (let i = 0; i < d.length; i += ch) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r > 200 && g < 90 && b < 90) redPx++;
      if (b > 150 && r < 110 && g < 150) bluePx++;
    }
    verdict(redPx > 20, 'red underline pixels painted', `redPx=${redPx}`);
    verdict(bluePx > 20, 'blue underline pixels painted', `bluePx=${bluePx}`);
    fs.writeFileSync(path.join(ROOT, 'test', 'shot.png'), shot);

    // 3. contenteditable
    await page.click('[contenteditable]');
    await page.keyboard.press('End');
    await page.keyboard.type(' teh fox jump', { delay: 20 });
    await new Promise((r) => setTimeout(r, 2000));
    const ce = await page.evaluate(() => ({
      spells: document.querySelectorAll('[contenteditable] .rtg-err-spell').length,
      grams: document.querySelectorAll('[contenteditable] .rtg-err-grammar').length
    }));
    verdict(ce.spells >= 1 && ce.grams >= 1, 'contenteditable underlines', JSON.stringify(ce));
  } catch (e) {
    console.log('FAIL exception', e.message);
    failures++;
  }
  await browser.close().catch(() => {});
  srv.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
