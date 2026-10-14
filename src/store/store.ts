// ───────────────────────────── App store ─────────────────────────────
// Minimal external store (no extra deps). Project bodies persist in IndexedDB (see db.ts), the small
// project index and settings in localStorage. The current project autosaves with a debounce and keeps
// an undo/redo history in memory.
import { useSyncExternalStore } from 'react';
import { type Project, type AppSettings, type Scene, makeProject, defaultSettings, uid } from '../types';
import { thumbnail } from '../engine/renderer';
import { getProject, putProject, removeProject, migrateFromLocalStorage } from './db';

export type View = 'dashboard' | 'script' | 'storyboard' | 'editor' | 'export' | 'settings' | 'characters' | 'batch';

export interface ProjectMeta { id: string; name: string; updatedAt: number; createdAt: number; thumbnail?: string; duration: number; scenes: number }

interface State {
  view: View;
  projects: ProjectMeta[];
  current: Project | null;
  past: Project[];
  future: Project[];
  saveState: 'saved' | 'saving' | 'dirty' | 'error';
  settings: AppSettings;
  selectedSceneIndex: number;
  selectedId: string | null;          // selected character / prop / clip id in editor
  toast: { id: number; kind: 'info' | 'error' | 'success'; text: string } | null;
}

const LS_INDEX = 'sticky-motion:projects';
const LS_SETTINGS = 'sticky-motion:settings';
const LS_LAST = 'sticky-motion:last-open';

const DEFAULT_SETTINGS: AppSettings = { theme: 'dark', autoplayPreview: true, defaultAspect: 'landscape', defaultFps: 30, previewQuality: 'high' };

function readJSON<T>(k: string, fallback: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }

let state: State = {
  view: 'dashboard',
  projects: readJSON<ProjectMeta[]>(LS_INDEX, []),
  current: null, past: [], future: [],
  saveState: 'saved',
  settings: { ...DEFAULT_SETTINGS, ...readJSON<Partial<AppSettings>>(LS_SETTINGS, {}) },
  selectedSceneIndex: 0, selectedId: null, toast: null,
};

const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
function set(patch: Partial<State>) { state = { ...state, ...patch }; emit(); }

export function useStore<T>(sel: (s: State) => T): T { return useSyncExternalStore(sub, () => sel(state), () => sel(state)); }
function sub(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export const getState = () => state;

// ── persistence ──
let saveTimer: any = null;
function persistIndex(projects: ProjectMeta[]) { localStorage.setItem(LS_INDEX, JSON.stringify(projects)); }
function metaOf(p: Project): ProjectMeta { return { id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt, thumbnail: p.thumbnail, duration: p.scenes.reduce((a, s) => a + s.duration, 0), scenes: p.scenes.length }; }

let thumbAt = 0;
let saving: Promise<void> = Promise.resolve();
/** Projects deleted this session: a save still queued for one of them must not bring it back. */
const deleted = new Set<string>();
export function saveNow(withThumb = false): Promise<void> {
  const p = state.current; if (!p) return saving;
  // thumbnails cost a full render, so refresh them at most every 5 s
  if (withThumb && p.scenes.length && Date.now() - thumbAt > 5000) { try { p.thumbnail = thumbnail(p); thumbAt = Date.now(); } catch {} }
  const meta = metaOf(p);
  // saves are queued so an older snapshot can never land after a newer one
  saving = saving.then(async () => {
    if (deleted.has(p.id)) return;
    await putProject(p);
    const projects = [meta, ...state.projects.filter(x => x.id !== p.id)].sort((a, b) => b.updatedAt - a.updatedAt);
    persistIndex(projects);
    set({ projects, saveState: state.current === p ? 'saved' : state.saveState });
  }).catch((e: any) => {
    set({ saveState: 'error' });
    toast('error', `Could not save project: ${e?.message ?? e}`);
  });
  return saving;
}
function scheduleSave() {
  set({ saveState: 'dirty' });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { set({ saveState: 'saving' }); saveNow(true); }, 700);
}
window.addEventListener('beforeunload', () => { if (state.current && state.saveState !== 'saved') saveNow(false); });

// ── actions ──
export function setView(view: View) { set({ view }); }
export function toast(kind: 'info' | 'error' | 'success', text: string) { const id = Date.now(); set({ toast: { id, kind, text } }); setTimeout(() => { if (state.toast?.id === id) set({ toast: null }); }, kind === 'error' ? 7000 : 3500); }
export function updateSettings(patch: Partial<AppSettings>) { const settings = { ...state.settings, ...patch }; localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); set({ settings }); }

export function newProject(name?: string, view: View = 'script'): Project {
  const p = makeProject(name ?? `Animation ${state.projects.length + 1}`, defaultSettings(state.settings.defaultAspect, state.settings.defaultFps));
  set({ current: p, past: [], future: [], selectedSceneIndex: 0, selectedId: null, view });
  localStorage.setItem(LS_LAST, p.id);
  saveNow(false);
  return p;
}

export async function openProject(id: string, view: View = 'editor'): Promise<boolean> {
  const p = await getProject(id).catch(() => undefined);
  if (!p) { toast('error', 'Project data not found'); return false; }
  set({ current: migrate(p), past: [], future: [], selectedSceneIndex: 0, selectedId: null, view: p.scenes.length ? view : 'script' });
  localStorage.setItem(LS_LAST, id);
  return true;
}
export function loadProjectObject(p: Project, view: View = 'editor') { set({ current: migrate(p), past: [], future: [], selectedSceneIndex: 0, selectedId: null, view }); localStorage.setItem(LS_LAST, p.id); saveNow(true); }

export async function duplicateProject(id: string) {
  const p = await getProject(id); if (!p) return;
  const copy: Project = { ...structuredClone(p), id: uid('prj'), name: `${p.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() };
  await putProject(copy);
  const projects = [metaOf(copy), ...state.projects].sort((a, b) => b.updatedAt - a.updatedAt); persistIndex(projects); set({ projects });
  toast('success', 'Project duplicated');
}
export function deleteProject(id: string) {
  deleted.add(id);
  if (state.current?.id === id) clearTimeout(saveTimer);
  // queued behind any save in flight, so that save cannot land after the delete
  saving = saving.then(() => removeProject(id)).catch(e => toast('error', `Could not delete project: ${e?.message ?? e}`));
  const projects = state.projects.filter(p => p.id !== id); persistIndex(projects);
  set({ projects, current: state.current?.id === id ? null : state.current, view: state.current?.id === id ? 'dashboard' : state.view });
}
export async function renameProject(id: string, name: string) {
  if (state.current?.id === id) { commit(p => ({ ...p, name })); return; }
  const p = await getProject(id); if (!p) return; p.name = name; p.updatedAt = Date.now(); await putProject(p);
  const projects = state.projects.map(m => m.id === id ? { ...m, name, updatedAt: p.updatedAt } : m); persistIndex(projects); set({ projects });
}

/** Apply an undoable change to the current project. */
export function commit(fn: (p: Project) => Project, opts: { undoable?: boolean } = {}) {
  const cur = state.current; if (!cur) return;
  const next = fn(cur); if (next === cur) return;
  next.updatedAt = Date.now();
  const undoable = opts.undoable !== false;
  set({ current: next, past: undoable ? [...state.past.slice(-79), cur] : state.past, future: undoable ? [] : state.future });
  scheduleSave();
}
export function updateScene(index: number, fn: (s: Scene) => Scene, opts: { undoable?: boolean } = {}) { commit(p => ({ ...p, scenes: p.scenes.map((s, i) => i === index ? fn(s) : s) }), opts); }
export function undo() { const prev = state.past[state.past.length - 1]; if (!prev || !state.current) return; set({ current: prev, past: state.past.slice(0, -1), future: [state.current, ...state.future] }); scheduleSave(); }
export function redo() { const next = state.future[0]; if (!next || !state.current) return; set({ current: next, future: state.future.slice(1), past: [...state.past, state.current] }); scheduleSave(); }
export function selectScene(i: number) { set({ selectedSceneIndex: Math.max(0, Math.min((state.current?.scenes.length ?? 1) - 1, i)) }); }
export function select(id: string | null) { set({ selectedId: id }); }

export async function restoreLast() {
  // ask the browser not to evict saved projects when disk space runs low
  navigator.storage?.persist?.().catch(() => {});
  await migrateFromLocalStorage().catch(() => {});
  const id = localStorage.getItem(LS_LAST);
  if (id && !state.current && state.projects.some(p => p.id === id)) { const p = await getProject(id).catch(() => undefined); if (p && !state.current) set({ current: migrate(p) }); }
}

function migrate(p: Project): Project {
  // forward-compatible defaults for older saves
  p.settings = { ...defaultSettings(), ...p.settings, subtitles: { ...defaultSettings().subtitles, ...(p.settings?.subtitles ?? {}) }, audio: { ...defaultSettings().audio, ...(p.settings?.audio ?? {}) } };
  p.characters = (p.characters ?? []).map(c => ({ ...({ accessories: [], face: true, lineWidth: 5, scale: 1, pitch: 1, voice: 'classic' } as Partial<Project['characters'][number]>), ...c }));
  p.scenes = (p.scenes ?? []).map(s => ({ ...({ props: [], actions: [], dialogue: [], sfx: [], texts: [], characters: [], camera: { shot: 'wide', move: 'static' }, transitionIn: 'fade' } as Partial<Scene>), ...s }));
  return p;
}

export function exportProjectJSON(p: Project) { const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${p.name.replace(/[^\w\- ]+/g, '')}.stickymotion.json`; a.click(); }
