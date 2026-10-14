import { useRef, useState } from 'react';
import { useStore, updateScene, select, selectScene } from '../../store/store';
import { seek } from '../../store/playback';
import { useTimeThrottled } from './Preview';
import { type Scene, type ActionClip, type DialogueLine, ACTIONS, sceneStartTimes, locateScene, uid } from '../../types';
import { collectSfx } from '../../engine/scene';
import { Icon } from '../../ui/icons';

type Item = { id: string; start: number; duration: number; label: string; color: string; kind: 'action' | 'dialogue' | 'sfx' | 'text' | 'camera' | 'bg' | 'music' | 'sub' };

export default function Timeline() {
  const project = useStore(s => s.current)!;
  const selectedId = useStore(s => s.selectedId);
  const t = useTimeThrottled();
  const [pps, setPps] = useState(70); // pixels per second
  const starts = sceneStartTimes(project);
  const { index, local } = locateScene(project, t);
  const scene = project.scenes[index];
  const scroller = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; kind: Item['kind']; mode: 'move' | 'trim'; startX: number; orig: { start: number; duration: number }; moved: boolean } | null>(null);
  if (!scene) return null;

  const W = Math.max(400, scene.duration * pps + 40);
  const toTime = (clientX: number) => { const r = scroller.current!.getBoundingClientRect(); return Math.max(0, Math.min(scene.duration, (clientX - r.left + scroller.current!.scrollLeft - 120) / pps)); };

  const chars = scene.characters.map(c => project.characters.find(x => x.id === c.characterId)).filter(Boolean) as typeof project.characters;
  const trackRows: { name: string; color?: string; items: Item[]; onAdd?: () => void }[] = [
    { name: 'Background', items: [{ id: 'bg', start: 0, duration: scene.duration, label: scene.background, color: '#2f3650', kind: 'bg' }] },
    { name: 'Camera', items: [{ id: 'cam', start: scene.camera.startAt ?? 0, duration: scene.duration - (scene.camera.startAt ?? 0), label: `${scene.camera.shot} · ${scene.camera.move.replace('_', ' ')}`, color: '#3b4a6e', kind: 'camera' }] },
    ...chars.flatMap(ch => [
      { name: `${ch.name} · moves`, color: ch.color, items: scene.actions.filter(a => a.characterId === ch.id && ['walk', 'run', 'chase', 'sneak', 'enter', 'exit', 'jump', 'sit', 'fall', 'slip', 'getup', 'dance', 'fight', 'pickup', 'turn', 'celebrate', 'freeze', 'stand'].includes(a.action)).map(a => ({ id: a.id, start: a.start, duration: a.duration, label: ACTIONS.find(x => x.name === a.action)?.label ?? a.action, color: ch.color, kind: 'action' as const })), onAdd: () => addAction(index, scene, ch.id, 'walk', local) },
      { name: `${ch.name} · gestures`, color: ch.color, items: scene.actions.filter(a => a.characterId === ch.id && !['walk', 'run', 'chase', 'sneak', 'enter', 'exit', 'jump', 'sit', 'fall', 'slip', 'getup', 'dance', 'fight', 'pickup', 'turn', 'celebrate', 'freeze', 'stand'].includes(a.action)).map(a => ({ id: a.id, start: a.start, duration: a.duration, label: ACTIONS.find(x => x.name === a.action)?.label ?? a.action, color: ch.color + 'bb', kind: 'action' as const })), onAdd: () => addAction(index, scene, ch.id, 'talk', local) },
    ]),
    { name: 'Dialogue', color: '#f5a524', items: scene.dialogue.filter(d => d.characterId !== 'narrator').map(d => ({ id: d.id, start: d.start, duration: d.duration, label: `${project.characters.find(c => c.id === d.characterId)?.name ?? '?'}: ${d.text}`, color: '#8a5a12', kind: 'dialogue' as const })), onAdd: () => addDialogue(index, scene, chars[0]?.id ?? 'narrator', local) },
    { name: 'Narration', color: '#ffe9a8', items: scene.dialogue.filter(d => d.characterId === 'narrator').map(d => ({ id: d.id, start: d.start, duration: d.duration, label: d.text, color: '#6b5b2a', kind: 'dialogue' as const })), onAdd: () => addDialogue(index, scene, 'narrator', local) },
    { name: 'Sound FX', color: '#3ddc97', items: [...scene.sfx.map(s => ({ id: s.id, start: s.start, duration: 0.3, label: s.name, color: '#1f7a55', kind: 'sfx' as const })), ...collectSfx({ ...project, scenes: [scene] }).filter(e => !scene.sfx.some(s => Math.abs(s.start - e.at) < 0.01 && s.name === e.name)).map((e, i) => ({ id: `auto_${i}`, start: e.at, duration: 0.25, label: e.name, color: '#1f7a5555', kind: 'sfx' as const }))], onAdd: () => updateScene(index, s => ({ ...s, sfx: [...s.sfx, { id: uid('sfx'), name: 'boing', start: local, volume: 1 }] })) },
    { name: 'Music', color: '#c084fc', items: project.settings.audio.musicEnabled && project.settings.audio.musicTrack !== 'none' ? [{ id: 'music', start: 0, duration: scene.duration, label: `${project.settings.audio.musicTrack} (project-wide)`, color: '#5b3a8a', kind: 'music' as const }] : [] },
    { name: 'Subtitles', color: '#fff', items: project.settings.subtitles.enabled ? scene.dialogue.filter(d => d.style === 'subtitle' || d.characterId === 'narrator').map(d => ({ id: `sub_${d.id}`, start: d.start, duration: d.duration, label: d.text, color: '#4a5272', kind: 'sub' as const })) : [] },
    { name: 'Text & captions', color: '#5aa9ff', items: scene.texts.map(x => ({ id: x.id, start: x.start, duration: x.duration, label: x.text, color: '#2d5f99', kind: 'text' as const })), onAdd: () => updateScene(index, s => ({ ...s, texts: [...s.texts, { id: uid('txt'), kind: 'caption', text: 'Caption', start: local, duration: 2, x: 0.5, y: 0.15, size: 1.1, color: '#ffffff', animation: 'pop' }] })) },
  ];

  // drag / trim
  const onItemDown = (e: React.PointerEvent, it: Item, mode: 'move' | 'trim') => {
    if (it.kind === 'bg' || it.kind === 'music' || it.kind === 'sub' || it.id.startsWith('auto_')) { if (it.kind === 'bg') select('scene'); if (it.kind === 'camera') select('camera'); return; }
    e.stopPropagation(); e.preventDefault();
    select(it.kind === 'camera' ? 'camera' : it.id);
    dragRef.current = { id: it.id, kind: it.kind, mode, startX: e.clientX, orig: { start: it.start, duration: it.duration }, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const dt = (e.clientX - d.startX) / pps;
    const snap = (v: number) => Math.round(v * 20) / 20;
    const first = !d.moved; d.moved = true;
    updateScene(index, s => {
      const upd = <T extends { start: number; duration?: number }>(x: T): T => d.mode === 'move' ? { ...x, start: snap(Math.max(0, Math.min(s.duration - 0.1, d.orig.start + dt))) } : { ...x, duration: snap(Math.max(0.2, d.orig.duration + dt)) };
      if (d.kind === 'action') return { ...s, actions: s.actions.map(a => a.id === d.id ? upd(a) : a) };
      if (d.kind === 'dialogue') return { ...s, dialogue: s.dialogue.map(a => a.id === d.id ? upd(a) : a) };
      if (d.kind === 'sfx') return { ...s, sfx: s.sfx.map(a => a.id === d.id ? { ...a, start: snap(Math.max(0, d.orig.start + dt)) } : a) };
      if (d.kind === 'text') return { ...s, texts: s.texts.map(a => a.id === d.id ? upd(a) : a) };
      if (d.kind === 'camera') return { ...s, camera: { ...s.camera, startAt: snap(Math.max(0, Math.min(s.duration - 0.5, d.orig.start + dt))) } };
      return s;
    }, { undoable: first });
  };
  const onUp = () => { dragRef.current = null; };

  const ticks: number[] = []; for (let s = 0; s <= scene.duration; s += scene.duration > 20 ? 2 : 1) ticks.push(s);

  return (
    <div className="flex flex-col h-full bg-ink-900 border-t border-ink-800 select-none">
      {/* scene strip */}
      <div className="flex items-center gap-1 px-2 h-9 border-b border-ink-800 overflow-x-auto shrink-0">
        <span className="label mr-2">Scenes</span>
        {project.scenes.map((s, i) => (
          <button key={s.id} onClick={() => { selectScene(i); seek(starts[i] + 0.55); select('scene'); }} className={`px-2 py-1 rounded-md text-xs whitespace-nowrap border ${i === index ? 'bg-ink-700 border-accent-500/60 text-white' : 'border-ink-700 text-ink-300 hover:bg-ink-800'}`}>{i + 1}. {s.title} <span className="text-ink-500">{s.duration.toFixed(1)}s</span></button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs text-ink-400 shrink-0">
          <span>Zoom</span><input type="range" min={30} max={200} value={pps} onChange={e => setPps(Number(e.target.value))} className="w-24" />
        </div>
      </div>
      <div ref={scroller} className="flex-1 overflow-auto relative" onPointerMove={onMove} onPointerUp={onUp}>
        <div style={{ width: W + 120 }} className="relative min-h-full">
          {/* ruler */}
          <div className="sticky top-0 z-20 h-6 bg-ink-900 border-b border-ink-800 flex">
            <div className="w-[120px] shrink-0 sticky left-0 bg-ink-900 z-30 border-r border-ink-800 text-[10px] text-ink-400 px-2 leading-6">scene time</div>
            <div className="relative flex-1 cursor-pointer" onPointerDown={e => { const tt = toTime(e.clientX); seek(starts[index] + tt); }}>
              {ticks.map(s => <div key={s} className="absolute top-0 h-full border-l border-ink-700 text-[10px] text-ink-400 pl-1" style={{ left: s * pps }}>{s}s</div>)}
            </div>
          </div>
          {/* tracks */}
          {trackRows.map(row => (
            <div key={row.name} className="flex h-8 border-b border-ink-850 group">
              <div className="w-[120px] shrink-0 sticky left-0 bg-ink-900 z-10 border-r border-ink-800 text-[11px] px-2 flex items-center gap-1 truncate" style={{ color: row.color ?? '#aab1c9' }}>
                <span className="truncate">{row.name}</span>
                {row.onAdd && <button className="ml-auto opacity-0 group-hover:opacity-100 text-ink-400 hover:text-white" title="Add at playhead" onClick={row.onAdd}><Icon.Plus size={12} /></button>}
              </div>
              <div className="relative flex-1" onPointerDown={e => { if (e.target === e.currentTarget) { seek(starts[index] + toTime(e.clientX)); } }}>
                {row.items.map(it => (
                  <div key={it.id} onPointerDown={e => onItemDown(e, it, 'move')} className={`absolute top-1 h-6 rounded-md text-[10px] leading-6 px-1.5 truncate cursor-grab active:cursor-grabbing border ${selectedId === it.id || (it.kind === 'camera' && selectedId === 'camera') ? 'border-white ring-1 ring-white/60' : 'border-black/30'}`} style={{ left: it.start * pps, width: Math.max(8, it.duration * pps), background: it.color, color: '#fff' }} title={it.label}>
                    {it.label}
                    {(it.kind === 'action' || it.kind === 'dialogue' || it.kind === 'text') && <div onPointerDown={e => onItemDown(e, it, 'trim')} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-white/20 hover:bg-white/50 rounded-r-md" />}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {/* playhead */}
          <div className="absolute top-0 bottom-0 w-px bg-accent-500 z-20 pointer-events-none" style={{ left: 120 + local * pps }}><div className="w-2.5 h-2.5 -ml-1 bg-accent-500 rotate-45 mt-1" /></div>
        </div>
      </div>
    </div>
  );
}

function addAction(index: number, scene: Scene, characterId: string, action: ActionClip['action'], at: number) {
  const def = ACTIONS.find(a => a.name === action)!;
  const clip: ActionClip = { id: uid('act'), characterId, action, start: Math.round(at * 10) / 10, duration: def.defaultDuration };
  updateScene(index, s => ({ ...s, actions: [...s.actions, clip], duration: Math.max(s.duration, clip.start + clip.duration + 0.3) }));
  select(clip.id);
}
function addDialogue(index: number, scene: Scene, characterId: string, at: number) {
  const line: DialogueLine = { id: uid('dlg'), characterId, text: characterId === 'narrator' ? 'Narration…' : 'Hello!', start: Math.round(at * 10) / 10, duration: 2, style: characterId === 'narrator' ? 'subtitle' : 'bubble' };
  updateScene(index, s => ({ ...s, dialogue: [...s.dialogue, line], duration: Math.max(s.duration, line.start + line.duration + 0.3) }));
  select(line.id);
}
