// ───────────────────────────── Audio engine ─────────────────────────────
// Everything is scheduled against a BaseAudioContext so the same code drives live preview
// (AudioContext) and offline rendering for export (OfflineAudioContext / MediaStreamDestination).

import type { Project, SfxName, DialogueLine } from '../types';
import { collectSfx } from './scene';
import { synthesizeVoice, VOICE_SAMPLE_RATE } from './voice';
import { isLibraryTrack, scheduleLibraryTrack, sharedNoise } from './music';

type Ctx = BaseAudioContext;

// ── SFX synthesis ──
function env(ctx: Ctx, at: number, a: number, d: number, peak: number) {
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), at + a); g.gain.exponentialRampToValueAtTime(0.0001, at + a + d); return g;
}
function tone(ctx: Ctx, dest: AudioNode, at: number, freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, at); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  const g = env(ctx, at, 0.01, dur, vol); o.connect(g).connect(dest); o.start(at); o.stop(at + dur + 0.05); return o;
}
function burst(ctx: Ctx, dest: AudioNode, at: number, dur: number, vol: number, filterHz = 2000, q = 1) {
  // slices of one shared, deterministic noise buffer: no allocation per hit, identical exports
  const s = ctx.createBufferSource(); s.buffer = sharedNoise(ctx);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filterHz; f.Q.value = q;
  const g = env(ctx, at, 0.005, dur, vol); s.connect(f).connect(g).connect(dest); s.start(at, (at * 3.17) % 0.85); s.stop(at + dur + 0.1); return s;
}

export function playSfx(ctx: Ctx, dest: AudioNode, name: SfxName, at: number, vol = 1) {
  switch (name) {
    case 'footsteps': burst(ctx, dest, at, 0.07, 0.5 * vol, 300, 2); break;
    case 'door': burst(ctx, dest, at, 0.12, 0.6 * vol, 600, 1); tone(ctx, dest, at + 0.05, 180, 0.25, 'square', 0.15 * vol, 120); break;
    case 'impact': burst(ctx, dest, at, 0.2, 1.0 * vol, 150, 0.7); tone(ctx, dest, at, 90, 0.3, 'sine', 0.6 * vol, 40); break;
    case 'crash': burst(ctx, dest, at, 0.5, 1.0 * vol, 1200, 0.5); burst(ctx, dest, at + 0.05, 0.4, 0.8 * vol, 400, 0.7); break;
    case 'boing': tone(ctx, dest, at, 220, 0.45, 'sine', 0.5 * vol, 660); tone(ctx, dest, at + 0.02, 110, 0.4, 'triangle', 0.3 * vol, 330); break;
    case 'whoosh': { const s = burst(ctx, dest, at, 0.35, 0.6 * vol, 800, 0.8); void s; break; }
    case 'slip': tone(ctx, dest, at, 900, 0.3, 'sawtooth', 0.25 * vol, 300); burst(ctx, dest, at, 0.25, 0.4 * vol, 3000, 2); break;
    case 'ding': tone(ctx, dest, at, 1320, 0.5, 'sine', 0.4 * vol); tone(ctx, dest, at, 2640, 0.3, 'sine', 0.15 * vol); break;
    case 'gasp': burst(ctx, dest, at, 0.25, 0.35 * vol, 1500, 1.5); tone(ctx, dest, at, 400, 0.2, 'sine', 0.1 * vol, 700); break;
    case 'laugh_track': for (let i = 0; i < 6; i++) { tone(ctx, dest, at + i * 0.13, 320 + (i % 2) * 40, 0.1, 'triangle', 0.25 * vol, 260); burst(ctx, dest, at + i * 0.13, 0.08, 0.2 * vol, 1200, 1); } break;
    case 'cheer': for (let i = 0; i < 10; i++) { burst(ctx, dest, at + i * 0.08, 0.3, 0.25 * vol, 900 + i * 120, 0.8); } tone(ctx, dest, at, 523, 0.3, 'triangle', 0.25 * vol); tone(ctx, dest, at + 0.15, 659, 0.3, 'triangle', 0.25 * vol); tone(ctx, dest, at + 0.3, 784, 0.5, 'triangle', 0.3 * vol); break;
    case 'none': break;
  }
}

// ── Procedural music ──
const TRACKS: Record<string, { bpm: number; prog: number[][]; wave: OscillatorType; bass: boolean; swing: number }> = {
  upbeat: { bpm: 128, prog: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [5, 9, 12]], wave: 'square', bass: true, swing: 0 },
  calm: { bpm: 72, prog: [[0, 4, 7, 11], [-3, 0, 4, 7], [-5, -1, 2, 7], [-3, 0, 4, 7]], wave: 'sine', bass: false, swing: 0 },
  comedy: { bpm: 140, prog: [[0, 4, 7], [0, 4, 7], [5, 9, 12], [7, 11, 14]], wave: 'triangle', bass: true, swing: 0.12 },
  tense: { bpm: 100, prog: [[0, 3, 7], [0, 3, 6], [-2, 1, 5], [0, 3, 7]], wave: 'sawtooth', bass: true, swing: 0 },
};
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// ── Voice clips ──
const bufferCache = new Map<string, Promise<AudioBuffer>>();
export async function loadBuffer(ctx: Ctx, url: string): Promise<AudioBuffer> {
  // keyed by the whole URL: two clips of the same length share their first bytes (the WAV header)
  if (!bufferCache.has(url)) {
    const job = fetch(url).then(r => r.arrayBuffer()).then(ab => ctx.decodeAudioData(ab.slice(0)));
    job.catch(() => bufferCache.delete(url));   // a failed load can be retried later
    bufferCache.set(url, job);
    if (bufferCache.size > 400) bufferCache.delete(bufferCache.keys().next().value!);
  }
  return bufferCache.get(url)!;
}

/**
 * Run `fn` and collect every oscillator and buffer source it creates on `ctx`, so they can all be
 * stopped later (otherwise each play/seek leaves thousands of scheduled notes alive).
 */
function collectSources(ctx: Ctx, sink: AudioScheduledSourceNode[], fn: () => void) {
  const c = ctx as any, osc = c.createOscillator, buf = c.createBufferSource;
  c.createOscillator = () => { const n = osc.call(ctx); sink.push(n); return n; };
  c.createBufferSource = () => { const n = buf.call(ctx); sink.push(n); return n; };
  try { fn(); } finally { delete c.createOscillator; delete c.createBufferSource; }
}

export interface ScheduledAudio { stop(): void }

export interface VoiceLine extends DialogueLine { absStart: number }
export function collectDialogue(project: Project): VoiceLine[] {
  const out: VoiceLine[] = []; let off = 0;
  for (const s of project.scenes) { for (const d of s.dialogue) out.push({ ...d, absStart: off + d.start }); off += s.duration; }
  return out;
}

/**
 * Schedule every audio event of the project from `fromTime` (project seconds) so that project time `fromTime`
 * corresponds to context time `ctxStart`. Buffers are pre-decoded with `preloadVoices`.
 */
export function scheduleProjectAudio(ctx: Ctx, dest: AudioNode, project: Project, fromTime: number, ctxStart: number, voices: Map<string, AudioBuffer>, opts: { endTime?: number } = {}): ScheduledAudio {
  const a = project.settings.audio;
  const total = project.scenes.reduce((s, x) => s + x.duration, 0);
  const endTime = opts.endTime ?? total;
  const master = ctx.createGain(); master.gain.value = a.masterVolume; master.connect(dest);
  const sfxG = ctx.createGain(); sfxG.gain.value = a.sfxVolume; sfxG.connect(master);
  const voiceG = ctx.createGain(); voiceG.gain.value = a.voiceVolume; voiceG.connect(master);
  const musicG = ctx.createGain(); musicG.gain.value = a.musicVolume; musicG.connect(master);
  const sources: AudioScheduledSourceNode[] = [];
  collectSources(ctx, sources, () => {

  if (a.sfxEnabled) for (const e of collectSfx(project)) {
    if (e.at < fromTime || e.at > endTime) continue;
    playSfx(ctx, sfxG, e.name, ctxStart + (e.at - fromTime), e.volume);
  }
  if (a.voiceEnabled) for (const line of collectDialogue(project)) {
    const buf = voices.get(line.id);
    if (!buf) continue;
    const end = line.absStart + buf.duration;
    if (end < fromTime || line.absStart > endTime) continue;
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(voiceG);
    const offset = Math.max(0, fromTime - line.absStart);
    src.start(ctxStart + Math.max(0, line.absStart - fromTime), offset);
    sources.push(src);
  }
  if (a.musicEnabled && a.musicTrack !== 'none') {
    if (a.importedMusicUrl && voices.get('__music__')) {
      const src = ctx.createBufferSource(); src.buffer = voices.get('__music__')!; src.loop = true; src.connect(musicG);
      src.start(ctxStart, fromTime % src.buffer.duration); src.stop(ctxStart + (endTime - fromTime)); sources.push(src);
    } else {
      // music is generated from project time 0 so its phase is stable when scrubbing
      if (isLibraryTrack(a.musicTrack)) scheduleLibraryTrack(ctx, musicG, a.musicTrack, fromTime, ctxStart, endTime, a.fadeIn, a.fadeOut, total);
      else scheduleMusicFrom(ctx, musicG, a.musicTrack, fromTime, ctxStart, endTime, a.fadeIn, a.fadeOut, total);
    }
  }
  });
  return { stop() { master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.01); setTimeout(() => { try { master.disconnect(); } catch {} for (const s of sources) { try { s.stop(); s.disconnect(); } catch {} } sources.length = 0; }, 60); } };
}

function scheduleMusicFrom(ctx: Ctx, dest: AudioNode, track: string, fromTime: number, ctxStart: number, endTime: number, fadeIn: number, fadeOut: number, total: number) {
  const T = TRACKS[track]; if (!T) return;
  const master = ctx.createGain();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; master.connect(lp).connect(dest);
  // fade envelope in project time
  const g = master.gain; g.setValueAtTime(0.0001, ctxStart);
  const fi = Math.max(0.05, fadeIn), fo = Math.max(0.05, fadeOut);
  const lvl = (pt: number) => Math.min(1, Math.max(0.0001, Math.min(pt / fi, (total - pt) / fo)));
  g.setValueAtTime(lvl(fromTime), ctxStart);
  for (let pt = Math.ceil(fromTime * 4) / 4; pt <= endTime; pt += 0.25) g.linearRampToValueAtTime(lvl(pt), ctxStart + (pt - fromTime));
  const beat = 60 / T.bpm; const root = 60;
  let t = 0, i = 0;
  while (t < endTime) {
    if (t >= fromTime - 0.01) {
      const chord = T.prog[Math.floor(i / 4) % T.prog.length]; const n = chord[i % chord.length];
      const at = ctxStart + (t - fromTime) + ((i % 2) ? T.swing * beat : 0);
      tone(ctx, master, at, midi(root + n), beat * 0.6, T.wave, 0.12);
      if (T.bass && i % 2 === 0) tone(ctx, master, at, midi(root + chord[0] - 24), beat * 0.9, 'sine', 0.2);
      if (i % 4 === 0) burst(ctx, master, at, 0.06, 0.12, 200, 1);
      if (i % 4 === 2) burst(ctx, master, at, 0.05, 0.08, 4000, 1);
    }
    t += beat / 2; i++;
  }
}

export async function preloadVoices(ctx: Ctx, project: Project): Promise<Map<string, AudioBuffer>> {
  const map = new Map<string, AudioBuffer>();
  const jobs: Promise<void>[] = [];
  // lines without an imported clip are spoken by the built-in voice
  const builtIn = (line: VoiceLine) => {
    const samples = synthesizeVoice(line.text, project.characters.find(c => c.id === line.characterId));
    if (!samples.length) return;
    const buf = ctx.createBuffer(1, samples.length, VOICE_SAMPLE_RATE); buf.getChannelData(0).set(samples); map.set(line.id, buf);
  };
  for (const line of collectDialogue(project)) {
    if (line.audioUrl) jobs.push(loadBuffer(ctx, line.audioUrl).then(b => { map.set(line.id, b); }).catch(() => builtIn(line)));
    else if (project.settings.audio.voiceEnabled) builtIn(line);
  }
  if (project.settings.audio.importedMusicUrl) jobs.push(loadBuffer(ctx, project.settings.audio.importedMusicUrl).then(b => { map.set('__music__', b); }).catch(() => {}));
  await Promise.all(jobs);
  return map;
}

/** Render the whole project's audio offline into a WAV blob (used for MP4 export muxing). */
export async function renderProjectAudio(project: Project, durationSec: number, sampleRate = 44100): Promise<{ wav: Blob; buffer: AudioBuffer }> {
  const ctx = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);
  const voices = await preloadVoices(ctx, project);
  scheduleProjectAudio(ctx, ctx.destination, project, 0, 0, voices, { endTime: durationSec });
  const buffer = await ctx.startRendering();
  return { wav: audioBufferToWav(buffer), buffer };
}

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels, len = buffer.length * numCh * 2 + 44;
  const ab = new ArrayBuffer(len), v = new DataView(ab);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, len - 8, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numCh, true);
  v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * numCh * 2, true); v.setUint16(32, numCh * 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, len - 44, true);
  let off = 44; const chans = Array.from({ length: numCh }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < buffer.length; i++) for (let c = 0; c < numCh; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2; }
  return new Blob([ab], { type: 'audio/wav' });
}
