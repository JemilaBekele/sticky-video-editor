// ───────────────────────────── Video export ─────────────────────────────
// Real rendering paths, all producing genuine playable files:
//   0. fast      : every frame rendered offline and encoded with WebCodecs (hardware H.264 + AAC) → MP4.
//                  Much faster than real time and unaffected by background-tab throttling.
//   1. realtime  : canvas.captureStream + MediaRecorder, audio mixed live through Web Audio → WebM
//   2. realtime → MP4 : the WebM above converted to H.264 (server ffmpeg if available, else ffmpeg.wasm)
//   3. frames    : every frame rendered offline at exact timestamps + offline-rendered WAV, encoded by ffmpeg.wasm → MP4
import type { Project, AspectPreset } from '../types';
import { ASPECT_SIZES, projectDuration } from '../types';
import { renderFrame } from '../engine/renderer';
import { preloadImages } from '../engine/backgrounds';
import { preloadVoices, scheduleProjectAudio, renderProjectAudio, collectDialogue } from '../engine/audio';
import { getServerStatus } from '../store/server';

export interface ExportOptions {
  aspect: AspectPreset;
  fps: 24 | 30 | 60;
  format: 'webm' | 'mp4';
  mode: 'fast' | 'realtime' | 'frames';
  scale?: number;              // 1 = full res, 0.5 = half
  includeAudio: boolean;
  signal?: AbortSignal;
  onProgress: (p: { phase: string; progress: number; detail?: string }) => void;
}

export interface ExportResult { blob: Blob; url: string; duration: number; width: number; height: number; size: number; mime: string; warnings: string[] }

export class ExportError extends Error {}

export function supportsRealtime() { return typeof MediaRecorder !== 'undefined' && typeof (HTMLCanvasElement.prototype as any).captureStream === 'function'; }

function pickMime(): string {
  const cands = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus', 'video/webm'];
  for (const c of cands) if (MediaRecorder.isTypeSupported(c)) return c;
  throw new ExportError('This browser cannot record WebM video. Use Chrome, Edge or Firefox.');
}

export async function exportVideo(project: Project, opts: ExportOptions): Promise<ExportResult> {
  if (!project.scenes.length) throw new ExportError('The project has no scenes to render.');
  await preloadImages(project.scenes.map(s => s.customBackgroundUrl));
  const duration = projectDuration(project);
  const base = ASPECT_SIZES[opts.aspect];
  const scale = opts.scale ?? 1;
  const width = Math.round(base.w * scale / 2) * 2, height = Math.round(base.h * scale / 2) * 2;
  const warnings: string[] = [];

  if (opts.mode === 'fast') {
    const blob = await encodeFast(project, width, height, duration, opts);
    return finish(blob, duration, width, height, warnings);
  }

  if (opts.mode === 'frames') {
    const blob = await renderFramesToMp4(project, width, height, duration, opts);
    return finish(blob, duration, width, height, warnings);
  }

  if (!supportsRealtime()) throw new ExportError('MediaRecorder is not available in this browser; switch to frame-by-frame mode.');
  const webm = await captureRealtime(project, width, height, duration, opts);
  if (opts.format === 'webm') return finish(webm, duration, width, height, warnings);

  // convert WebM → MP4
  const status = await getServerStatus();
  if (status.ffmpeg) {
    opts.onProgress({ phase: 'Converting to MP4 (server ffmpeg)', progress: 0.9 });
    try {
      const r = await fetch(`/api/convert?fps=${opts.fps}`, { method: 'POST', body: webm, headers: { 'Content-Type': 'video/webm' }, signal: opts.signal });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `server error ${r.status}`);
      const mp4 = await r.blob();
      return finish(new Blob([mp4], { type: 'video/mp4' }), duration, width, height, warnings);
    } catch (e: any) {
      if (opts.signal?.aborted) throw new ExportError('Export cancelled');
      warnings.push(`Server conversion failed (${e.message}); converting in the browser instead.`);
    }
  }
  const mp4 = await transcodeWithWasm(webm, opts);
  return finish(mp4, duration, width, height, warnings);
}

function finish(blob: Blob, duration: number, width: number, height: number, warnings: string[]): ExportResult {
  return { blob, url: URL.createObjectURL(blob), duration, width, height, size: blob.size, mime: blob.type, warnings };
}

// ───────────────────────────── 1. Real-time capture ─────────────────────────────
async function captureRealtime(project: Project, W: number, H: number, duration: number, opts: ExportOptions): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const fps = opts.fps;
  const mime = pickMime();

  const stream = (canvas as any).captureStream(0) as MediaStream;
  const videoTrack = stream.getVideoTracks()[0] as any;

  // audio graph
  const ac = new AudioContext({ sampleRate: 48000 });
  let rec: MediaRecorder | null = null;
  try {
  await ac.resume();
  let audioDest: MediaStreamAudioDestinationNode | null = null;
  let voices = new Map();
  if (opts.includeAudio) {
    audioDest = ac.createMediaStreamDestination();
    for (const t of audioDest.stream.getAudioTracks()) stream.addTrack(t);
    opts.onProgress({ phase: 'Loading audio', progress: 0 });
    voices = await preloadVoices(ac, project);
  }

  renderFrame(ctx, project, 0, W, H);
  videoTrack.requestFrame?.();

  rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(W * H * fps * 0.12), audioBitsPerSecond: 160000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const recorder = rec;
  const stopped = new Promise<void>(res => { recorder.onstop = () => res(); });
  rec.start(250);

  // deterministic clock: project time is derived from the audio clock, frames are quantised to the fps grid
  const startAt = ac.currentTime + 0.15;
  const sched = opts.includeAudio && audioDest ? scheduleProjectAudio(ac, audioDest, project, 0, startAt, voices) : null;
  let lastFrame = -1;
  const frameTime = 1 / fps;

  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (opts.signal?.aborted) { reject(new ExportError('Export cancelled')); return; }
      const t = ac.currentTime - startAt;
      if (t >= duration + 0.05) { resolve(); return; }
      if (t >= 0) {
        const f = Math.floor(t / frameTime);
        if (f !== lastFrame) {
          lastFrame = f;
          renderFrame(ctx, project, Math.min(duration - 0.001, f * frameTime), W, H);
          videoTrack.requestFrame?.();
          opts.onProgress({ phase: 'Recording', progress: Math.min(0.88, (t / duration) * 0.88), detail: `${t.toFixed(1)}s / ${duration.toFixed(1)}s` });
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).finally(() => { sched?.stop(); });

  // flush
  renderFrame(ctx, project, duration - 0.001, W, H); videoTrack.requestFrame?.();
  await new Promise(r => setTimeout(r, 120));
  rec.stop();
  await stopped;
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  if (blob.size < 1000) throw new ExportError('Recording produced no data. The browser may have throttled the tab — keep it visible while exporting.');
  return blob;
  } finally {
    // cancelled or failed too: nothing may keep recording in the background
    if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch {} }
    stream.getTracks().forEach(t => t.stop());
    if (ac.state !== 'closed') await ac.close().catch(() => {});
  }
}

// ───────────────────────────── 0. WebCodecs fast path ─────────────────────────────
export function supportsFast() { return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'; }

// H.264 High profile at increasing levels (4.0 covers 1080p30, 4.2 adds 1080p60)
const AVC_CODECS = ['avc1.640028', 'avc1.64002a', 'avc1.640032', 'avc1.4d0028', 'avc1.42e028'];

async function pickVideoConfig(W: number, H: number, fps: number): Promise<VideoEncoderConfig> {
  for (const codec of AVC_CODECS) {
    const config: VideoEncoderConfig = { codec, width: W, height: H, framerate: fps, bitrate: Math.round(W * H * fps * 0.12), avc: { format: 'avc' } };
    if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
  }
  throw new ExportError('This browser cannot encode H.264 video. Choose another render mode.');
}

async function encodeFast(project: Project, W: number, H: number, duration: number, opts: ExportOptions): Promise<Blob> {
  if (!supportsFast()) throw new ExportError('Fast export needs a Chromium-based browser (Chrome or Edge). Choose another render mode.');
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const fps = opts.fps, total = Math.ceil(duration * fps);
  const videoConfig = await pickVideoConfig(W, H, fps);

  // audio is rendered offline first, so it is sample-exact with the frames
  let audio: AudioBuffer | null = null, audioConfig: AudioEncoderConfig | null = null;
  if (opts.includeAudio) {
    opts.onProgress({ phase: 'Rendering audio', progress: 0 });
    try {
      audio = (await renderProjectAudio(project, duration, 48000)).buffer;
      if (opts.signal?.aborted) throw new ExportError('Export cancelled');
      for (const codec of ['mp4a.40.2', 'opus']) {
        const c: AudioEncoderConfig = { codec, sampleRate: 48000, numberOfChannels: audio.numberOfChannels, bitrate: 160000 };
        if ((await AudioEncoder.isConfigSupported(c)).supported) { audioConfig = c; break; }
      }
    } catch (e) { if (e instanceof ExportError) throw e; console.warn('audio render failed', e); }
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width: W, height: H, frameRate: fps },
    ...(audio && audioConfig ? { audio: { codec: audioConfig.codec === 'opus' ? 'opus' as const : 'aac' as const, sampleRate: 48000, numberOfChannels: audio.numberOfChannels } } : {}),
  });
  // encoder errors arrive in callbacks; keep the first one
  const err: { first?: Error } = {};
  const fail = (e: any) => { err.first ??= e instanceof Error ? e : new Error(String(e)); };

  if (audio && audioConfig) {
    const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: fail });
    enc.configure(audioConfig);
    const CH = audio.numberOfChannels, BLOCK = 4800;
    const chans = Array.from({ length: CH }, (_, c) => audio!.getChannelData(c));
    for (let off = 0; off < audio.length; off += BLOCK) {
      const n = Math.min(BLOCK, audio.length - off), data = new Float32Array(n * CH);
      for (let c = 0; c < CH; c++) data.set(chans[c].subarray(off, off + n), c * n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: CH, timestamp: Math.round((off / 48000) * 1e6), data });
      enc.encode(ad); ad.close();
    }
    try { await enc.flush(); } catch (e) { fail(e); } finally { if (enc.state !== 'closed') enc.close(); }
    if (err.first) throw new ExportError(`Audio encoder failed: ${err.first.message}. Choose another render mode.`);
    if (opts.signal?.aborted) throw new ExportError('Export cancelled');
  }

  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: fail });
  enc.configure(videoConfig);
  const frameUs = 1e6 / fps;
  const started = performance.now();
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) { enc.close(); throw new ExportError('Export cancelled'); }
    if (err.first) break;
    renderFrame(ctx, project, Math.min(duration - 0.0005, i / fps), W, H);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
    enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    // backpressure: let the encoder catch up instead of queueing thousands of frames in memory
    while (enc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 1));
    if (i % 10 === 0) {
      const rate = (i + 1) / ((performance.now() - started) / 1000);
      opts.onProgress({ phase: 'Encoding video', progress: 0.05 + 0.93 * (i / total), detail: `${i}/${total} frames · ${(rate / fps).toFixed(1)}× real time` });
      await new Promise(r => setTimeout(r, 0));
    }
  }
  if (!err.first) await enc.flush().catch(fail);
  enc.close();
  if (err.first) throw new ExportError(`Video encoder failed: ${err.first.message}. Choose another render mode.`);
  muxer.finalize();
  return new Blob([target.buffer], { type: 'video/mp4' });
}

// ───────────────────────────── ffmpeg.wasm helpers ─────────────────────────────
let ffmpegInstance: any = null;
async function getFfmpeg(onLog?: (s: string) => void) {
  if (ffmpegInstance) return ffmpegInstance;
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ff = new FFmpeg();
  if (onLog) ff.on('log', (e: any) => onLog(e.message));
  const base = `${location.origin}/ffmpeg`;
  try {
    await ff.load({ coreURL: `${base}/ffmpeg-core.js`, wasmURL: `${base}/ffmpeg-core.wasm` });
  } catch (e: any) {
    throw new ExportError(`Could not load the in-browser video encoder (ffmpeg.wasm): ${e?.message ?? e}. Make sure public/ffmpeg/ contains ffmpeg-core.js and ffmpeg-core.wasm (npm install copies them).`);
  }
  ffmpegInstance = ff;
  return ff;
}

/** Run ffmpeg.wasm with progress reporting; Cancel terminates it (the next export loads a fresh one). */
async function runFfmpeg(ff: any, args: string[], opts: ExportOptions, phase: string, from: number, span: number): Promise<number> {
  const onProgress = (e: any) => opts.onProgress({ phase, progress: from + span * Math.min(1, Math.max(0, e.progress)) });
  ff.on('progress', onProgress);
  const onAbort = () => { try { ff.terminate(); } catch {} if (ffmpegInstance === ff) ffmpegInstance = null; };
  opts.signal?.addEventListener('abort', onAbort);
  try {
    const code = await ff.exec(args);
    if (opts.signal?.aborted) throw new ExportError('Export cancelled');
    return code;
  } catch (e) {
    if (opts.signal?.aborted) throw new ExportError('Export cancelled');
    throw e;
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    try { ff.off('progress', onProgress); } catch {}
  }
}

async function transcodeWithWasm(webm: Blob, opts: ExportOptions): Promise<Blob> {
  opts.onProgress({ phase: 'Loading in-browser encoder', progress: 0.9 });
  const ff = await getFfmpeg();
  await ff.writeFile('in.webm', new Uint8Array(await webm.arrayBuffer()));
  const code = await runFfmpeg(ff, ['-i', 'in.webm', '-r', String(opts.fps), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'out.mp4'], opts, 'Converting to MP4 (ffmpeg.wasm)', 0.9, 0.1);
  if (code !== 0) throw new ExportError('ffmpeg.wasm failed to convert the recording to MP4.');
  const data = await ff.readFile('out.mp4');
  await ff.deleteFile('in.webm'); await ff.deleteFile('out.mp4');
  return new Blob([data], { type: 'video/mp4' });
}

// ───────────────────────────── 3. Frame-by-frame offline render ─────────────────────────────
async function renderFramesToMp4(project: Project, W: number, H: number, duration: number, opts: ExportOptions): Promise<Blob> {
  const fps = opts.fps;
  const total = Math.ceil(duration * fps);
  opts.onProgress({ phase: 'Loading in-browser encoder', progress: 0 });
  const ff = await getFfmpeg();
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const names: string[] = [];
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) { await cleanup(ff, names); throw new ExportError('Export cancelled'); }
    renderFrame(ctx, project, Math.min(duration - 0.0005, i / fps), W, H);
    const blob: Blob = await new Promise(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.92));
    const name = `f${String(i).padStart(5, '0')}.jpg`;
    await ff.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
    names.push(name);
    if (i % 5 === 0) opts.onProgress({ phase: 'Rendering frames', progress: (i / total) * 0.55, detail: `${i}/${total}` });
    if (i % 30 === 0) await new Promise(r => setTimeout(r, 0));
  }
  let hasAudio = false;
  if (opts.includeAudio) {
    opts.onProgress({ phase: 'Rendering audio', progress: 0.56 });
    try { const { wav } = await renderProjectAudio(project, duration); await ff.writeFile('audio.wav', new Uint8Array(await wav.arrayBuffer())); hasAudio = true; } catch (e) { console.warn('audio render failed', e); }
  }
  const args = ['-framerate', String(fps), '-i', 'f%05d.jpg', ...(hasAudio ? ['-i', 'audio.wav'] : []), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps), ...(hasAudio ? ['-c:a', 'aac', '-b:a', '160k', '-shortest'] : []), '-movflags', '+faststart', 'out.mp4'];
  const code = await runFfmpeg(ff, args, opts, 'Encoding H.264', 0.6, 0.4);
  await cleanup(ff, names);
  if (hasAudio) await ff.deleteFile('audio.wav').catch(() => {});
  if (code !== 0) throw new ExportError('ffmpeg.wasm failed while encoding the MP4.');
  const data = await ff.readFile('out.mp4');
  await ff.deleteFile('out.mp4');
  return new Blob([data], { type: 'video/mp4' });
}

async function cleanup(ff: any, names: string[]) { for (const n of names) await ff.deleteFile(n).catch(() => {}); }

export function fmtBytes(n: number) { return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(0)} KB`; }
export function fmtTime(s: number) { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, '0')}`; }

// ───────────────────────────── Upload extras ─────────────────────────────
/** All dialogue as an .srt caption file (YouTube, TikTok and most editors accept it). */
export function buildSrt(project: Project): string {
  const ts = (s: number) => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3.6e6), m = Math.floor(ms / 6e4) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  return collectDialogue(project).sort((a, b) => a.absStart - b.absStart).map((d, i) => {
    const who = project.characters.find(c => c.id === d.characterId);
    return `${i + 1}\n${ts(d.absStart)} --> ${ts(d.absStart + d.duration)}\n${who ? `${who.name}: ` : ''}${d.text}\n`;
  }).join('\n');
}

/** A still of the animation at `time`, sized for a YouTube thumbnail (1280×720) or the project's own shape. */
export async function renderStill(project: Project, time: number, W: number, H: number): Promise<Blob> {
  await preloadImages(project.scenes.map(s => s.customBackgroundUrl));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  renderFrame(c.getContext('2d')!, project, time, W, H);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new ExportError('Could not create the image'))), 'image/png'));
}
