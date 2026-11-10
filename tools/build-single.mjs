// Construit dist/FouDuRoi.html : toute l'application dans un seul fichier,
// qui s'ouvre par double-clic (aucun serveur nécessaire).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p, enc = 'utf8') => readFileSync(join(root, p), enc);

const bundle = await build({
  entryPoints: [join(root, 'js/app.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
  legalComments: 'inline',
});
const appJs = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const css = read('css/style.css').replace(/<\/style/gi, '<\\/style');
const workerB64 = read('vendor/stockfish/stockfish-19-lite-single.js', null).toString('base64');
const wasmB64 = read('vendor/stockfish/stockfish-19-lite-single.wasm', null).toString('base64');
const sample = read('samples/exemple.pgn');

// Code ajouté en tête du worker : sert le fichier .wasm depuis la mémoire.
const workerPrelude = `
(function () {
  var b64 = self.__FDR_WASM_B64__;
  var bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  var realFetch = self.fetch;
  self.fetch = function (url) {
    if (String(url).indexOf('fdr-inline.wasm') !== -1) {
      return Promise.resolve(new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } }));
    }
    return realFetch.apply(self, arguments);
  };
})();
`;

const boot = `
(function () {
  function txt(id) { return document.getElementById(id).textContent.trim(); }
  try {
    var workerSrc = atob(txt('fdr-worker'));
    var wasm = txt('fdr-wasm');
    var code = 'self.__FDR_WASM_B64__=' + JSON.stringify(wasm) + ';' + ${JSON.stringify(workerPrelude)} + '\\n' + workerSrc;
    var url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    window.__FDR_ENGINE_URL__ = url + '#fdr-inline.wasm';
  } catch (e) { console.error('Préparation du moteur impossible', e); }
  window.__FDR_SAMPLE_PGN__ = JSON.parse(txt('fdr-sample'));
})();
`;

let html = read('index.html');
html = html.replace(/^.*data-pwa.*\n/gm, '');
html = html.replace(/<link rel="stylesheet" href="css\/style.css">/, () => `<style>\n${css}\n</style>`);
html = html.replace(/<script type="module" src="js\/app.js"><\/script>/, () => [
  `<script type="text/plain" id="fdr-worker">${workerB64}</script>`,
  `<script type="text/plain" id="fdr-wasm">${wasmB64}</script>`,
  `<script type="application/json" id="fdr-sample">${JSON.stringify(sample).replace(/</g, '\\u003c')}</script>`,
  `<script>${boot}</script>`,
  `<script>${appJs}</script>`,
].join('\n'));

if (html.includes('src="js/app.js"') || html.includes('href="css/style.css"')) {
  throw new Error('Remplacement dans index.html échoué');
}

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist/FouDuRoi.html');
writeFileSync(out, html);
console.log(`OK : ${out} (${(html.length / 1e6).toFixed(1)} Mo)`);
