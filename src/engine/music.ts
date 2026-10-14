// ───────────────────────────── Music library ─────────────────────────────
// Royalty-free background music, composed and synthesized in code: piano, pads, bass, drums and a
// generated reverb. Every track is a pure function of project time, so scrubbing, preview and export
// all hear the same notes, and arrangements build over the length of the video.

type Ctx = BaseAudioContext;

export interface TrackInfo { id: string; label: string; mood: string }
export const LIBRARY: TrackInfo[] = [
  { id: 'inspiring', label: 'Inspiring', mood: 'Piano and strings that build — motivation, success stories' },
  { id: 'epic', label: 'Epic', mood: 'Cinematic drums and low strings — challenges, comebacks' },
  { id: 'sad', label: 'Sad piano', mood: 'Slow minor piano — struggle, loss, reflection' },
  { id: 'lofi', label: 'Lo-fi', mood: 'Mellow beat with vinyl crackle — calm, study, daily life' },
  { id: 'hype', label: 'Hype', mood: 'Fast trap drums and bass — workouts, energy, wins' },
];

// deterministic noise (the same project always renders the same audio)
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const noiseCache = new WeakMap<Ctx, AudioBuffer>();
/** One shared second of noise per context; hits play slices of it instead of allocating new buffers. */
export function sharedNoise(ctx: Ctx): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) { b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = b.getChannelData(0), r = rng(7); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; noiseCache.set(ctx, b); }
  return b;
}
const reverbCache = new WeakMap<Ctx, AudioBuffer>();
function impulse(ctx: Ctx) {
  let b = reverbCache.get(ctx);
  if (!b) {
    const len = Math.round(ctx.sampleRate * 2.4), r = rng(11); b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 3); }
    reverbCache.set(ctx, b);
  }
  return b;
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

interface Bus { dry: AudioNode; wet: AudioNode }
function voice(ctx: Ctx, bus: Bus, at: number, dur: number, peak: number, attack: number, release: number, wet: number, build: (out: AudioNode) => AudioScheduledSourceNode[]) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.setValueAtTime(peak, at + Math.max(attack, dur - release)); g.gain.linearRampToValueAtTime(0.0001, at + dur);
  g.connect(bus.dry);
  if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w).connect(bus.wet); }
  for (const s of build(g)) { s.start(at); s.stop(at + dur + 0.05); }
}

const piano = (ctx: Ctx, bus: Bus, at: number, note: number, dur: number, vol: number, wet = 0.35) => {
  const f = hz(note), g = ctx.createGain();
  // struck-string tone: a few harmonics with a fast exponential decay
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.008); g.gain.exponentialRampToValueAtTime(vol * 0.3, at + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.6, dur * 1.6));
  g.connect(bus.dry); const w = ctx.createGain(); w.gain.value = wet; g.connect(w).connect(bus.wet);
  for (const [mult, amp, type] of [[1, 1, 'triangle'], [2, 0.35, 'sine'], [3, 0.12, 'sine'], [4.01, 0.05, 'sine']] as [number, number, OscillatorType][]) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mult; const a = ctx.createGain(); a.gain.value = amp; o.connect(a).connect(g); o.start(at); o.stop(at + Math.max(0.6, dur * 1.6) + 0.05);
  }
};
const pad = (ctx: Ctx, bus: Bus, at: number, notes: number[], dur: number, vol: number, bright = 1200) => voice(ctx, bus, at, dur, vol, Math.min(1.2, dur * 0.4), Math.min(1.2, dur * 0.4), 0.6, out => {
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = bright; lp.connect(out);
  return notes.flatMap(n => [-7, 7].map(cents => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = cents; const a = ctx.createGain(); a.gain.value = 0.5 / notes.length; o.connect(a).connect(lp); return o; }));
});
const bass = (ctx: Ctx, bus: Bus, at: number, note: number, dur: number, vol: number) => voice(ctx, bus, at, dur, vol, 0.01, Math.min(0.15, dur / 2), 0, out => {
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(note); o.connect(out);
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = hz(note); const a = ctx.createGain(); a.gain.value = 0.3; o2.connect(a).connect(out);
  return [o, o2];
});
const kick = (ctx: Ctx, bus: Bus, at: number, vol: number, boom = 1) => {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.12 * boom);
  g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35 * boom);
  o.connect(g).connect(bus.dry); o.start(at); o.stop(at + 0.4 * boom);
};
const noiseHit = (ctx: Ctx, bus: Bus, at: number, dur: number, vol: number, type: BiquadFilterType, freq: number, wet = 0.15) => {
  const s = ctx.createBufferSource(); s.buffer = sharedNoise(ctx);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(bus.dry); if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w).connect(bus.wet); }
  // a different slice of the shared noise for each hit
  s.start(at, (at * 7.31) % 0.9, dur + 0.02);
};
const snare = (ctx: Ctx, bus: Bus, at: number, vol: number) => { noiseHit(ctx, bus, at, 0.18, vol, 'bandpass', 1800, 0.3); voice(ctx, bus, at, 0.1, vol * 0.5, 0.002, 0.08, 0, out => { const o = ctx.createOscillator(); o.frequency.value = 190; o.connect(out); return [o]; }); };
const hat = (ctx: Ctx, bus: Bus, at: number, vol: number, open = false) => noiseHit(ctx, bus, at, open ? 0.25 : 0.05, vol, 'highpass', 7000, 0);
const boomHit = (ctx: Ctx, bus: Bus, at: number, vol: number) => { kick(ctx, bus, at, vol, 2.5); noiseHit(ctx, bus, at, 1.2, vol * 0.4, 'lowpass', 400, 0.8); };

// chords as semitones from the key root
const MINOR_EPIC = [[0, 3, 7], [-4, 0, 3], [-9, -5, 0], [-2, 2, 5]];        // i  VI  III  VII
const MAJOR_INSPIRE = [[0, 4, 7], [-5, 0, 4], [-3, 0, 4], [-7, -3, 0]];     // I  V  vi  IV
const SAD = [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-5, -1, 2]];              // i  VI  iv  V
const LOFI = [[0, 4, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 4], [-5, -1, 2, 5]]; // Imaj7 vi7 IVmaj7 V7
const HYPE = [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]];

type Section = { at: number; bar: number; beat: number; chord: number[]; build: number };
interface TrackDef { bpm: number; root: number; prog: number[][]; swing?: number; gain?: number; play: (s: Section, ctx: Ctx, bus: Bus, beatLen: number) => void }

const TRACKS: Record<string, TrackDef> = {
  inspiring: {
    bpm: 96, root: 60, prog: MAJOR_INSPIRE,
    play: ({ at, beat, chord, build }, ctx, bus, b) => {
      const R = 60;
      if (beat === 0) { pad(ctx, bus, at, chord.map(n => R + n - 12), b * 4, 0.05 + 0.04 * build, 900 + build * 1500); bass(ctx, bus, at, R + chord[0] - 24, b * 4, 0.18); }
      // arpeggio in eighths
      for (let e = 0; e < 2; e++) { const n = chord[(beat * 2 + e) % chord.length] + (e && beat % 2 ? 12 : 0); piano(ctx, bus, at + e * b / 2, R + n, b / 2, 0.12 + 0.05 * build); }
      if (build > 0.45) { if (beat % 2 === 0) kick(ctx, bus, at, 0.5 * build); else snare(ctx, bus, at, 0.18 * build); }
      if (build > 0.7) hat(ctx, bus, at + b / 2, 0.05);
    },
  },
  epic: {
    bpm: 84, root: 50, prog: MINOR_EPIC, gain: 0.8,
    play: ({ at, beat, bar, chord, build }, ctx, bus, b) => {
      const R = 50;
      if (beat === 0) { pad(ctx, bus, at, chord.map(n => R + n), b * 4, 0.07 + 0.05 * build, 700 + build * 1800); bass(ctx, bus, at, R + chord[0] - 12, b * 4, 0.22); if (bar % 4 === 0) boomHit(ctx, bus, at, 0.7); }
      // ostinato strings in eighths
      for (let e = 0; e < 2; e++) voice(ctx, bus, at + e * b / 2, b / 2, 0.05 + 0.04 * build, 0.01, 0.1, 0.3, out => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(R + 12 + chord[(beat + e) % 3]); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; o.connect(lp).connect(out); return [o]; });
      if (build > 0.3) { kick(ctx, bus, at, 0.6, 1.3); if (beat === 2) snare(ctx, bus, at, 0.3); }
      if (build > 0.6 && beat % 2 === 1) { kick(ctx, bus, at + b / 2, 0.4, 1.3); noiseHit(ctx, bus, at, 0.4, 0.12, 'lowpass', 900, 0.6); }
    },
  },
  sad: {
    bpm: 66, root: 57, prog: SAD, gain: 3.2,
    play: ({ at, beat, chord, build }, ctx, bus, b) => {
      const R = 57;
      if (beat === 0) { piano(ctx, bus, at, R + chord[0] - 12, b * 4, 0.14, 0.5); pad(ctx, bus, at, chord.map(n => R + n), b * 4, 0.025 + 0.025 * build, 700); }
      piano(ctx, bus, at, R + 12 + chord[[0, 1, 2, 1][beat]], b, 0.1, 0.55);
      if (beat === 3 && build > 0.5) piano(ctx, bus, at + b / 2, R + 14 + chord[1], b / 2, 0.06, 0.6);
    },
  },
  lofi: {
    bpm: 78, root: 62, prog: LOFI, swing: 0.16,
    play: ({ at, beat, chord }, ctx, bus, b) => {
      const R = 62;
      if (beat === 0 || beat === 2) chord.forEach((n, i) => piano(ctx, bus, at + i * 0.018, R + n - 12, b * 2, 0.07, 0.3));
      if (beat === 0) bass(ctx, bus, at, R + chord[0] - 24, b * 1.5, 0.2);
      if (beat === 0 || beat === 2) kick(ctx, bus, at, 0.45); if (beat === 2) kick(ctx, bus, at + b * 0.75, 0.3);
      if (beat === 1 || beat === 3) snare(ctx, bus, at, 0.13);
      hat(ctx, bus, at, 0.04); hat(ctx, bus, at + b / 2, 0.025);
      noiseHit(ctx, bus, at + b * 0.37, 0.02, 0.03, 'highpass', 3000, 0);   // vinyl crackle
    },
  },
  hype: {
    bpm: 140, root: 45, prog: HYPE,
    play: ({ at, beat, chord, build }, ctx, bus, b) => {
      const R = 45;
      if (beat === 0) { bass(ctx, bus, at, R + chord[0] - 12, b * 1.5, 0.3); pad(ctx, bus, at, chord.map(n => R + 24 + n), b * 4, 0.035, 2500); }
      if (beat === 2) bass(ctx, bus, at + b / 2, R + chord[0] - 12, b, 0.25);
      if (beat === 0 || (beat === 2 && build > 0.3)) kick(ctx, bus, at, 0.65, 1.6);
      if (beat === 1 || beat === 3) { snare(ctx, bus, at, 0.25); noiseHit(ctx, bus, at, 0.1, 0.12, 'bandpass', 3000, 0.2); }
      // trap hats: eighths, rolling to sixteenths and triplets as the track builds
      const subs = build > 0.5 && beat === 3 ? 6 : build > 0.25 ? 4 : 2;
      for (let i = 0; i < subs; i++) hat(ctx, bus, at + (i * b) / subs, 0.05);
    },
  },
};

export const isLibraryTrack = (id: string) => id in TRACKS;

/**
 * Schedule a library track from project time `fromTime` (mapped to context time `ctxStart`) until `endTime`.
 * The arrangement builds with the position in the whole video (`total`), and fades follow fadeIn/fadeOut.
 */
export function scheduleLibraryTrack(ctx: Ctx, dest: AudioNode, id: string, fromTime: number, ctxStart: number, endTime: number, fadeIn: number, fadeOut: number, total: number) {
  const T = TRACKS[id]; if (!T) return;
  const out = ctx.createGain();
  const fi = Math.max(0.05, fadeIn), fo = Math.max(0.05, fadeOut);
  const lvl = (pt: number) => Math.min(1, Math.max(0.0001, Math.min(pt / fi, (total - pt) / fo)));
  out.gain.setValueAtTime(lvl(fromTime), ctxStart);
  for (let pt = Math.ceil(fromTime * 4) / 4; pt <= endTime; pt += 0.25) out.gain.linearRampToValueAtTime(lvl(pt), ctxStart + (pt - fromTime));
  // a limiter keeps every track below clipping and evens out loudness between tracks
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -12; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.25;
  const trim = ctx.createGain(); trim.gain.value = T.gain ?? 1;
  trim.connect(lim).connect(out); out.connect(dest);
  const rev = ctx.createConvolver(); rev.buffer = impulse(ctx); const wet = ctx.createGain(); wet.gain.value = 0.5; rev.connect(wet).connect(trim);
  const bus: Bus = { dry: trim, wet: rev };
  const b = 60 / T.bpm;
  for (let i = 0, t = 0; t < endTime; i++, t = i * b) {
    const at = t + ((i % 2) ? (T.swing ?? 0) * b : 0);
    if (at < fromTime - 0.01) continue;
    const bar = Math.floor(i / 4);
    T.play({ at: ctxStart + (at - fromTime), bar, beat: i % 4, chord: T.prog[bar % T.prog.length], build: Math.min(1, t / Math.max(1, total * 0.85)) }, ctx, bus, b);
  }
}
