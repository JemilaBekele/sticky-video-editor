// ───────────────────────────── Playback controller ─────────────────────────────
// Owns the preview clock. Time is derived from the AudioContext clock while playing so audio and
// frames stay locked; when paused the time is whatever the user scrubbed to.
import { useSyncExternalStore } from 'react';
import type { Project } from '../types';
import { projectDuration } from '../types';
import { preloadVoices, scheduleProjectAudio, collectDialogue, type ScheduledAudio } from '../engine/audio';

interface PB { time: number; playing: boolean; speed: number; loop: boolean; muted: boolean }
let pb: PB = { time: 0, playing: false, speed: 1, loop: false, muted: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const sub = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const usePlayback = <T,>(sel: (s: PB) => T) => useSyncExternalStore(sub, () => sel(pb), () => sel(pb));
export const getPlayback = () => pb;

let ac: AudioContext | null = null;
let sched: ScheduledAudio | null = null;
let startCtxTime = 0, startProjTime = 0;
let raf = 0;
let projectRef: Project | null = null;
// bumped by every play/pause: a play() still loading voices gives up if it is no longer the latest
let playToken = 0;
let starting = false;
let voicesCache: { key: string; map: Map<string, AudioBuffer> } | null = null;

export function attachProject(p: Project) { projectRef = p; }

function ensureCtx() { if (!ac) ac = new AudioContext(); if (ac.state === 'suspended') ac.resume(); return ac; }

async function voices(p: Project) {
  const voiceOf = (id: string) => { const c = p.characters.find(x => x.id === id); return c ? c.voice + c.pitch : ''; };
  const key = collectDialogue(p).map(d => d.id + (d.audioUrl?.length ?? d.text + voiceOf(d.characterId))).join('|') + (p.settings.audio.importedMusicUrl?.length ?? 0) + p.settings.audio.voiceEnabled;
  if (voicesCache?.key === key) return voicesCache.map;
  const map = await preloadVoices(ensureCtx(), p);
  voicesCache = { key, map };
  return map;
}

export function currentTime(): number {
  if (pb.playing && ac && !starting) return Math.min(startProjTime + (ac.currentTime - startCtxTime) * pb.speed, projectRef ? projectDuration(projectRef) : Infinity);
  return pb.time;
}

export async function play() {
  const p = projectRef; if (!p || !p.scenes.length) return;
  const dur = projectDuration(p);
  if (pb.time >= dur - 0.01) pb.time = 0;
  const ctx = ensureCtx();
  const token = ++playToken;
  // show as playing right away, so Pause/Stop work while voices are still loading
  starting = true; pb = { ...pb, playing: true }; emit();
  const v = await voices(p);
  if (token !== playToken || p.id !== projectRef?.id) { if (token === playToken) { starting = false; pb = { ...pb, playing: false }; emit(); } return; }
  starting = false;
  startCtxTime = ctx.currentTime + 0.05; startProjTime = pb.time;
  sched?.stop();
  sched = pb.muted ? null : scheduleProjectAudio(ctx, ctx.destination, p, pb.time, startCtxTime, v);
  pb = { ...pb, playing: true }; emit();
  cancelAnimationFrame(raf);
  const loop = () => {
    const t = currentTime();
    if (t >= dur) { if (pb.loop) { pause(); pb.time = 0; play(); return; } pause(); pb = { ...pb, time: dur }; emit(); return; }
    pb = { ...pb, time: t }; emit();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

export function pause() { playToken++; if (pb.playing) pb = { ...pb, time: currentTime(), playing: false }; starting = false; cancelAnimationFrame(raf); sched?.stop(); sched = null; emit(); }
export function stop() { pause(); pb = { ...pb, time: 0 }; emit(); }
export function seek(t: number) { const was = pb.playing; if (was) pause(); pb = { ...pb, time: Math.max(0, projectRef ? Math.min(t, projectDuration(projectRef)) : t) }; emit(); if (was) play(); }
export function toggle() { pb.playing ? pause() : play(); }
export function setSpeed(s: number) { const was = pb.playing; if (was) pause(); pb = { ...pb, speed: s }; emit(); if (was) play(); }
export function setLoop(l: boolean) { pb = { ...pb, loop: l }; emit(); }
export function setMuted(m: boolean) { const was = pb.playing; if (was) pause(); pb = { ...pb, muted: m }; emit(); if (was) play(); }
/** Re-sync audio after the project changed while playing. */
export function refresh() { if (pb.playing) { pause(); play(); } }
