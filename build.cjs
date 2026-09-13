// Build: bundle content + background (each with nspell) and copy the
// dictionary-en aff/dic for local runtime loading (no network, ever).
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const common = {
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome100'],
  logLevel: 'info'
};

async function main() {
  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src', 'content.js')],
    outfile: path.join(root, 'dist', 'content.bundle.js')
  });
  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src', 'background.js')],
    outfile: path.join(root, 'dist', 'background.bundle.js')
  });
  fs.mkdirSync(path.join(root, 'dist', 'dict'), { recursive: true });
  for (const f of ['index.aff', 'index.dic']) {
    fs.copyFileSync(
      path.join(root, 'node_modules', 'dictionary-en', f),
      path.join(root, 'dist', 'dict', f)
    );
  }
  console.log('build done: dist/*.bundle.js + dist/dict/');
}

main().catch((e) => { console.error(e); process.exit(1); });
