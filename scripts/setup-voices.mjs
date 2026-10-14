// Downloads the natural (neural) voices once, so speech is generated offline afterwards.
//   node scripts/setup-voices.mjs          → default voices (~205 MB)
// Runtime files (speech engine) are copied from node_modules on every run; models are only
// downloaded when missing. Voices are Piper models (https://github.com/rhasspy/piper), MIT/CC licensed
// per model card.
import { existsSync, mkdirSync, copyFileSync, writeFileSync, statSync, createWriteStream, renameSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VOICES_DIR = path.join(root, 'voices');
const BASE = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main';
export const MODELS = ['en_US-ryan-medium', 'en_US-lessac-medium', 'en_US-libritts_r-medium'];

copyRuntime();
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && !process.argv.includes('--runtime-only')) await downloadModels();

/** Speech engine files: phonemizer (espeak-ng) and the ONNX runtime. Small, copied on install. */
export function copyRuntime() {
  const out = path.join(VOICES_DIR, 'runtime');
  mkdirSync(out, { recursive: true });
  const piper = path.join(root, 'node_modules/@diffusionstudio/piper-wasm/build');
  const ort = path.join(root, 'node_modules/onnxruntime-web/dist');
  if (!existsSync(piper) || !existsSync(ort)) { console.warn('[voices] speech engine packages missing — run npm install'); return; }
  for (const f of ['piper_phonemize.js', 'piper_phonemize.wasm', 'piper_phonemize.data']) copyFileSync(path.join(piper, f), path.join(out, f));
  for (const f of readdirSync(ort)) if (/^ort-wasm.*\.wasm$/.test(f) && !f.includes('training')) copyFileSync(path.join(ort, f), path.join(out, f));
}

async function downloadModels() {
  mkdirSync(VOICES_DIR, { recursive: true });
  for (const name of MODELS) {
    const [lang, region, speaker, quality] = [name.slice(0, 2), name.split('-')[0], name.split('-')[1], name.split('-')[2]];
    const rel = `${lang}/${region}/${speaker}/${quality}/${name}`;
    for (const ext of ['.onnx.json', '.onnx']) {
      const dest = path.join(VOICES_DIR, name + ext);
      if (existsSync(dest) && statSync(dest).size > 0) { console.log(`[voices] ${name + ext} already downloaded`); continue; }
      const res = await fetch(`${BASE}/${rel}${ext}`);
      if (!res.ok || !res.body) throw new Error(`download failed (${res.status}) for ${name + ext}`);
      const total = Number(res.headers.get('content-length') ?? 0);
      let got = 0, shown = -1;
      const counter = new TransformStream({ transform(chunk, ctl) { got += chunk.length; const pct = total ? Math.floor((got / total) * 100) : 0; if (pct !== shown && pct % 10 === 0) { shown = pct; process.stdout.write(`\r[voices] ${name + ext} ${pct}%   `); } ctl.enqueue(chunk); } });
      await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), createWriteStream(dest + '.part'));
      renameSync(dest + '.part', dest);
      process.stdout.write(`\r[voices] ${name + ext} done (${(got / 1e6).toFixed(0)} MB)\n`);
    }
  }
  writeFileSync(path.join(VOICES_DIR, 'manifest.json'), JSON.stringify({ models: MODELS }, null, 2));
  console.log('[voices] natural voices ready. Restart the app to use them.');
}
