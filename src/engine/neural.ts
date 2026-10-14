// ───────────────────────────── Natural voices ─────────────────────────────
// Neural (Piper) voices, generated offline in a worker from models downloaded once with
// `npm run voices`. Lines spoken with them are stored as WAV clips on the dialogue line.
import type { Character } from '../types';
import type { SynthRequest, SynthResponse } from './neuralWorker';
import { audioBufferToWav } from './audio';

export interface NeuralVoice { id: string; label: string; model: string; speaker?: number }

const RYAN = 'en_US-ryan-medium', LESSAC = 'en_US-lessac-medium', LIBRI = 'en_US-libritts_r-medium';
/**
 * Character voices. libritts_r holds hundreds of speakers in one model; these were picked for a wide,
 * clearly different range and are labelled by measured pitch (median F0 of a test sentence).
 */
export const NEURAL_VOICES: NeuralVoice[] = [
  { id: 'n:ryan', label: 'Narrator · steady (Ryan)', model: RYAN },
  { id: 'n:lessac', label: 'Clear · mid-high (Lessac)', model: LESSAC },
  { id: 'n:lib:380', label: 'Very deep', model: LIBRI, speaker: 380 },
  { id: 'n:lib:200', label: 'Deep', model: LIBRI, speaker: 200 },
  { id: 'n:lib:260', label: 'Warm · mid', model: LIBRI, speaker: 260 },
  { id: 'n:lib:140', label: 'Light', model: LIBRI, speaker: 140 },
  { id: 'n:lib:20', label: 'Bright', model: LIBRI, speaker: 20 },
  { id: 'n:lib:60', label: 'High', model: LIBRI, speaker: 60 },
];
export const NARRATOR_VOICE = 'n:ryan';
/** Default voices for new characters, alternating low and high so two characters never sound alike. */
export const CHARACTER_VOICE_ORDER = ['n:lib:200', 'n:lib:20', 'n:lib:380', 'n:lessac', 'n:lib:260', 'n:lib:60', 'n:lib:140'];

export const isNeural = (voice?: string) => !!voice?.startsWith('n:');

let installed: Promise<Set<string>> | null = null;
/** Models present on this machine (empty until `npm run voices` has been run). */
export function installedModels(force = false): Promise<Set<string>> {
  if (!installed || force) installed = fetch('/voices/manifest.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : { models: [] })).then(j => new Set<string>(j.models ?? [])).catch(() => new Set<string>());
  return installed;
}
export async function availableVoices(): Promise<NeuralVoice[]> { const m = await installedModels(); return NEURAL_VOICES.filter(v => m.has(v.model)); }

let worker: Worker | null = null, nextId = 1;
const pending = new Map<number, { resolve: (r: { samples: Float32Array; sampleRate: number }) => void; reject: (e: Error) => void }>();
/** Fail every waiting line and start a fresh worker next time (a crashed or stuck worker never answers). */
function resetWorker(reason: string) {
  worker?.terminate(); worker = null;
  for (const p of pending.values()) p.reject(new Error(reason));
  pending.clear();
}
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./neuralWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SynthResponse>) => {
      const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id);
      'error' in e.data ? p.reject(new Error(e.data.error)) : p.resolve(e.data);
    };
    worker.onerror = e => { e.preventDefault(); resetWorker(`The voice engine stopped: ${e.message || 'failed to load'}`); };
    worker.onmessageerror = () => resetWorker('The voice engine sent an unreadable reply');
  }
  return worker;
}
/** A line normally takes well under a second; this only catches a hung engine (the first model load is slower). */
const LINE_TIMEOUT_MS = 90_000;

export interface VoiceClip { url: string; duration: number }
const cache = new Map<string, Promise<VoiceClip>>();

/** Speak `text` with a natural voice. Results are cached per voice and text. */
export function speakNatural(text: string, voiceId: string, rate = 1): Promise<VoiceClip> {
  const v = NEURAL_VOICES.find(x => x.id === voiceId) ?? NEURAL_VOICES[0];
  const key = `${v.id}|${rate}|${text}`;
  if (!cache.has(key)) {
    const job = new Promise<{ samples: Float32Array; sampleRate: number }>((resolve, reject) => {
      const req: SynthRequest = { id: nextId++, text: text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"), model: v.model, speaker: v.speaker, lengthScale: 1 / rate };
      const timer = setTimeout(() => { if (pending.has(req.id)) resetWorker('The voice engine did not respond'); }, LINE_TIMEOUT_MS);
      pending.set(req.id, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } });
      getWorker().postMessage(req);
    }).then(({ samples, sampleRate }) => {
      const trimmed = trimSilence(samples, sampleRate);
      const buf = new AudioBuffer({ length: Math.max(1, trimmed.length), sampleRate, numberOfChannels: 1 });
      buf.getChannelData(0).set(trimmed);
      return blobToUrl(audioBufferToWav(buf)).then(url => ({ url, duration: trimmed.length / sampleRate }));
    });
    job.catch(() => cache.delete(key));
    cache.set(key, job);
  }
  return cache.get(key)!;
}

/** Voice for a character (or the narrator when no character is given). */
export function voiceFor(ch?: Character): string { return ch ? ch.voice : NARRATOR_VOICE; }
/** Speaking rate from the character's pitch setting, kept gentle so speech stays natural. */
export function rateFor(ch?: Character) { return ch ? Math.min(1.25, Math.max(0.8, 1 + ((ch.pitch ?? 1) - 1) * 0.3)) : 0.95; }

function trimSilence(s: Float32Array, rate: number) {
  const thr = 0.01, pad = Math.round(rate * 0.05);
  let a = 0, b = s.length - 1;
  while (a < s.length && Math.abs(s[a]) < thr) a++;
  while (b > a && Math.abs(s[b]) < thr) b--;
  return s.subarray(Math.max(0, a - pad), Math.min(s.length, b + pad));
}
function blobToUrl(b: Blob): Promise<string> { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = rej; fr.readAsDataURL(b); }); }
