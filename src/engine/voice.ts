// ───────────────────────────── Built-in voice ─────────────────────────────
// Offline text-to-speech (SAM formant synthesizer, pure JS). Synthesis is deterministic and fast,
// so clips are generated on demand for preview and export and are never stored in the project.

import SamJs from 'sam-js';
import type { Character } from '../types';

export const VOICE_SAMPLE_RATE = 22050;

interface VoiceParams { speed: number; pitch: number; mouth: number; throat: number }

export const VOICES: { id: string; label: string; params: VoiceParams }[] = [
  { id: 'classic', label: 'Classic', params: { speed: 72, pitch: 64, mouth: 128, throat: 128 } },
  { id: 'deep', label: 'Deep', params: { speed: 76, pitch: 84, mouth: 140, throat: 150 } },
  { id: 'bright', label: 'Bright', params: { speed: 70, pitch: 50, mouth: 150, throat: 120 } },
  { id: 'elf', label: 'Elf', params: { speed: 72, pitch: 64, mouth: 160, throat: 110 } },
  { id: 'robot', label: 'Little robot', params: { speed: 86, pitch: 60, mouth: 190, throat: 190 } },
  { id: 'stuffy', label: 'Stuffy guy', params: { speed: 80, pitch: 72, mouth: 105, throat: 110 } },
  { id: 'granny', label: 'Little old lady', params: { speed: 80, pitch: 34, mouth: 145, throat: 145 } },
  { id: 'alien', label: 'Alien', params: { speed: 90, pitch: 64, mouth: 200, throat: 150 } },
];
const NARRATOR: VoiceParams = { speed: 74, pitch: 72, mouth: 128, throat: 128 };

// voice ids saved by older projects
const LEGACY: Record<string, string> = { alloy: 'classic', echo: 'deep', nova: 'bright', onyx: 'stuffy', shimmer: 'elf', fable: 'granny', ash: 'deep', coral: 'bright', sage: 'classic' };

function paramsFor(ch?: Character): VoiceParams {
  if (!ch) return NARRATOR;
  const v = VOICES.find(x => x.id === ch.voice) ?? VOICES.find(x => x.id === LEGACY[ch.voice]) ?? VOICES[0];
  // SAM pitch is inverted: a lower number sounds higher
  return { ...v.params, pitch: Math.round(Math.min(120, Math.max(20, v.params.pitch / (ch.pitch || 1)))) };
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numberWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberWords(n % 100) : '');
  for (const [size, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']] as [number, string][]) {
    if (n >= size) return numberWords(Math.floor(n / size)) + ' ' + name + (n % size ? ' ' + numberWords(n % size) : '');
  }
  return '';
}

/** Reduce arbitrary dialogue to what the synthesizer can pronounce, split into short chunks. */
function speakable(text: string): string[] {
  const s = text
    .replace(/[‘’]/g, "'").replace(/[“”"]/g, '').replace(/[–—]|\.{2,}|…/g, ', ')
    .replace(/\$\s?(\d[\d,]*)/g, '$1 dollars').replace(/(\d),(?=\d{3})/g, '$1').replace(/%/g, ' percent').replace(/&/g, ' and ')
    .replace(/\d+/g, d => d.length > 12 ? d.split('').map(c => ONES[Number(c)]).join(' ') : numberWords(Number(d)))
    .replace(/[^A-Za-z .,?!'\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const chunks: string[] = [];
  for (const sentence of s.split(/(?<=[.?!,])\s+/)) {
    let cur = '';
    for (const word of sentence.split(' ')) {
      if (cur && cur.length + word.length + 1 > 80) { chunks.push(cur); cur = ''; }
      cur += (cur ? ' ' : '') + word;
    }
    if (/[A-Za-z]/.test(cur)) chunks.push(cur);
  }
  return chunks;
}

const cache = new Map<string, Float32Array>();

/** Synthesize a line as mono samples at VOICE_SAMPLE_RATE. Pass no character for the narrator. */
export function synthesizeVoice(text: string, ch?: Character): Float32Array {
  const p = paramsFor(ch);
  const key = `${p.speed}/${p.pitch}/${p.mouth}/${p.throat}/${text}`;
  const hit = cache.get(key); if (hit) return hit;
  const sam = new SamJs(p);
  const gap = Math.round(VOICE_SAMPLE_RATE * 0.08);
  const parts: Float32Array[] = [];
  for (const chunk of speakable(text)) {
    let buf: Float32Array | Boolean = false;
    try { buf = sam.buf32(chunk); } catch { /* unpronounceable chunk */ }
    if (!(buf instanceof Float32Array)) { try { buf = sam.buf32(chunk.replace(/[^A-Za-z ]/g, ' ')); } catch { buf = false; } }
    // keep timing even when a chunk cannot be pronounced
    parts.push(buf instanceof Float32Array ? buf : new Float32Array(Math.round(VOICE_SAMPLE_RATE * chunk.split(' ').length / 2.6)));
    parts.push(new Float32Array(gap));
  }
  const out = new Float32Array(parts.reduce((n, x) => n + x.length, 0));
  let off = 0; for (const x of parts) { out.set(x, off); off += x.length; }
  if (cache.size > 300) cache.clear();
  cache.set(key, out);
  return out;
}

/** How long a line takes to say with the built-in voice, plus a short pause. */
export function speechDuration(text: string, ch?: Character): number {
  return Math.max(1.2, Math.round((synthesizeVoice(text, ch).length / VOICE_SAMPLE_RATE + 0.3) * 10) / 10);
}
