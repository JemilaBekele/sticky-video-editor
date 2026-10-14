// ───────────────────────────── Sticky Motion AI — local server ─────────────────────────────
// Serves the built client and provides:
//   GET  /api/status   → whether the system ffmpeg is installed
//   POST /api/convert  → WebM → MP4 (H.264) using the system ffmpeg when installed
import express from 'express';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, '..', '.env'));

const PORT = Number(process.env.PORT || 8787);
const ffmpegAvailable = detectFfmpeg();

const app = express();
app.use(express.json({ limit: '25mb' }));

app.get('/api/status', (_req, res) => { res.json({ ffmpeg: ffmpegAvailable }); });

// WebM (VP8/VP9 + Opus) → MP4 (H.264 + AAC) via system ffmpeg
app.post('/api/convert', express.raw({ type: '*/*', limit: '2gb' }), (req, res) => {
  if (!ffmpegAvailable) return res.status(503).json({ error: 'ffmpeg is not installed on the server' });
  const dir = mkdtempSync(path.join(tmpdir(), 'sticky-'));
  const inPath = path.join(dir, 'in.webm'), outPath = path.join(dir, 'out.mp4');
  try {
    writeFileSync(inPath, req.body);
    const fps = String(Math.min(60, Math.max(1, Number(req.query.fps) || 30)));
    const args = ['-y', '-i', inPath, '-r', fps, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '160k', outPath];
    const proc = spawn('ffmpeg', args);
    let log = '', finished = false;
    const cleanup = () => rmSync(dir, { recursive: true, force: true });
    proc.stderr.on('data', d => { log += d.toString(); if (log.length > 20000) log = log.slice(-10000); });
    // the browser cancelled or went away: stop transcoding instead of finishing a file nobody will read
    res.on('close', () => { if (!finished) proc.kill('SIGKILL'); });
    // a failed launch emits 'error' (unhandled, it would crash the whole server)
    proc.on('error', e => { if (finished) return; finished = true; cleanup(); if (!res.headersSent) res.status(500).json({ error: `could not start ffmpeg: ${e.message}` }); });
    proc.on('close', code => {
      if (finished) { cleanup(); return; }
      finished = true;
      if (code !== 0 || !existsSync(outPath)) { cleanup(); if (!res.writableEnded) res.status(500).json({ error: 'ffmpeg conversion failed', log: log.slice(-1500) }); return; }
      if (!res.writableEnded) { res.setHeader('content-type', 'video/mp4'); res.send(readFileSync(outPath)); }
      cleanup();
    });
  } catch (e) { rmSync(dir, { recursive: true, force: true }); res.status(500).json({ error: e.message }); }
});

// ── Natural voice models (downloaded once by `npm run voices`) ──
const voicesDir = path.join(__dirname, '..', 'voices');
app.use('/voices', (_, res, next) => { res.setHeader('Cross-Origin-Resource-Policy', 'same-origin'); next(); }, express.static(voicesDir, { maxAge: '30d', immutable: true }));
app.get('/voices/*', (_req, res) => res.status(404).end());

// ── Static client (production) ──
const dist = path.join(__dirname, '..', 'dist');
if (existsSync(dist)) {
  app.use((_, res, next) => { res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); next(); });
  app.use(express.static(dist));
  // the app's own pages only: a missing API route or file must be a 404, not the app's HTML
  app.get('*', (req, res) => (req.path.startsWith('/api/') || path.extname(req.path) ? res.status(404).end() : res.sendFile(path.join(dist, 'index.html'))));
}

app.listen(PORT, () => {
  console.log(`Sticky Motion AI server on http://localhost:${PORT}`);
  console.log(`  ffmpeg      : ${ffmpegAvailable ? 'available → fast MP4 conversion' : 'not found → in-browser ffmpeg.wasm'}`);
  if (!existsSync(dist)) console.log('  (no dist/ yet — run `npm run build` for production, or use `npm run dev`)');
});

function detectFfmpeg() { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } }
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').split(' #')[0].trim();
  }
}
