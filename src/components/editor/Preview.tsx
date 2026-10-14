import { useEffect, useRef } from 'react';
import { useStore, select, updateScene, getState } from '../../store/store';
import { getPlayback, currentTime, usePlayback } from '../../store/playback';
import { renderFrame, stageFor, type HitBox } from '../../engine/renderer';
import { ASPECT_SIZES, locateScene } from '../../types';
import { useElementSize } from '../hooks';

/** Live preview canvas. Draws on every animation frame from the deterministic project clock. */
export default function Preview({ interactive = true, showSafe = false }: { interactive?: boolean; showSafe?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(wrap);
  const project = useStore(s => s.current)!;
  const selectedId = useStore(s => s.selectedId);
  const quality = useStore(s => s.settings.previewQuality);
  const hits = useRef<HitBox[]>([]);
  const projRef = useRef(project); projRef.current = project;
  const selRef = useRef(selectedId); selRef.current = selectedId;

  const ar = ASPECT_SIZES[project.settings.aspect];
  const scale = Math.min(size.w / ar.w, size.h / ar.h) || 0;
  const cw = Math.floor(ar.w * scale), ch = Math.floor(ar.h * scale);
  const dpr = quality === 'high' ? Math.min(2, window.devicePixelRatio || 1) : 1;

  useEffect(() => {
    let raf = 0; let last = -1; let lastProj: any = null; let lastSel: any = null;
    const loop = () => {
      const c = canvas.current;
      if (c && c.width > 0) {
        const t = currentTime();
        if (t !== last || lastProj !== projRef.current || lastSel !== selRef.current) {
          last = t; lastProj = projRef.current; lastSel = selRef.current;
          const ctx = c.getContext('2d')!;
          hits.current = [];
          renderFrame(ctx, projRef.current, t, c.width, c.height, { selectedId: selRef.current ?? undefined, showGuides: interactive, showSafeArea: showSafe, hits: hits.current });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [interactive, showSafe]);

  // pointer interaction: select & drag characters / props
  useEffect(() => {
    const c = canvas.current; if (!c || !interactive) return;
    let drag: { kind: 'character' | 'prop'; id: string; startX: number; startY: number; origX: number; origY: number; sceneIndex: number; moved: boolean } | null = null;
    const toCanvas = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
    const down = (e: PointerEvent) => {
      const { x, y } = toCanvas(e);
      const hit = [...hits.current].reverse().find(h => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
      const p = projRef.current; const { index } = locateScene(p, currentTime());
      if (!hit) { select(null); return; }
      select(hit.id);
      const sc = p.scenes[index];
      if (hit.kind === 'character') { const scc = sc.characters.find(k => k.characterId === hit.id); if (scc) drag = { kind: 'character', id: hit.id, startX: x, startY: y, origX: scc.x, origY: 0, sceneIndex: index, moved: false }; }
      else { const pr = sc.props.find(k => k.id === hit.id); if (pr) drag = { kind: 'prop', id: hit.id, startX: x, startY: y, origX: pr.x, origY: pr.y, sceneIndex: index, moved: false }; }
      c.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const { x, y } = toCanvas(e);
      const st = stageFor(c.width, c.height);
      const zoom = 1; // dragging is in stage space; approximate with no camera zoom correction for simplicity
      const dx = (x - drag.startX) / c.width / zoom, dy = -(y - drag.startY) / c.height;
      const d = drag;
      // edit the scene the drag started in, and record one undo step per drag
      const first = !d.moved; d.moved = true;
      updateScene(d.sceneIndex, s => d.kind === 'character'
        ? { ...s, characters: s.characters.map(k => k.characterId === d.id ? { ...k, x: Math.max(0.02, Math.min(0.98, d.origX + dx)) } : k) }
        : { ...s, props: s.props.map(k => k.id === d.id ? { ...k, x: Math.max(0.02, Math.min(0.98, d.origX + dx)), y: Math.max(0, Math.min(0.6, d.origY + dy)) } : k) }, { undoable: first });
      void st;
    };
    const up = () => { drag = null; };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up);
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); };
  }, [interactive]);

  return (
    <div ref={wrap} className="w-full h-full grid place-items-center bg-[radial-gradient(circle_at_center,#141826_0%,#0a0c12_70%)]">
      {cw > 0 && <canvas ref={canvas} width={Math.round(cw * dpr)} height={Math.round(ch * dpr)} style={{ width: cw, height: ch }} className={`rounded-md shadow-2xl ring-1 ring-ink-700 ${interactive ? 'cursor-crosshair' : ''}`} />}
    </div>
  );
}

export function useCurrentSceneIndex() {
  const project = useStore(s => s.current)!;
  // paused: follow seeks immediately, so clicking a scene shows it before the next edit lands;
  // playing: the throttled clock is enough
  const paused = usePlayback(s => (s.playing ? null : s.time));
  const t = useTimeThrottled();
  return locateScene(project, paused ?? t).index;
}

// re-render React at ~15fps for time displays without flooding
import { useState } from 'react';
export function useTimeThrottled() {
  const [t, setT] = useState(getPlayback().time);
  useEffect(() => { let raf = 0; let last = 0; const loop = (now: number) => { if (now - last > 66) { last = now; const ct = currentTime(); setT(prev => (Math.abs(prev - ct) > 0.001 ? ct : prev)); } raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf); }, []);
  return t;
}
export { getState };
