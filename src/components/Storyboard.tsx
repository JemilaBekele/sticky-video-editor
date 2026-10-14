import { useEffect, useRef, useState } from 'react';
import { useStore, commit, updateScene, setView, selectScene, toast } from '../store/store';
import { regenerateScene, reportGeneration } from '../store/generate';
import { renderFrame } from '../engine/renderer';
import { type Project, type Scene, type Transition, BACKGROUNDS, ACTIONS, makeScene, uid, sceneStartTimes } from '../types';
import { Icon } from '../ui/icons';
import { seek } from '../store/playback';

export function SceneThumb({ project, sceneIndex, at, className }: { project: Project; sceneIndex: number; at?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scene = project.scenes[sceneIndex];
  useEffect(() => {
    const c = ref.current; if (!c || !scene) return;
    const ar = project.settings.aspect === 'portrait' ? 9 / 16 : project.settings.aspect === 'square' ? 1 : 16 / 9;
    const w = 480; c.width = w; c.height = Math.round(w / ar);
    const starts = sceneStartTimes(project);
    const local = at ?? Math.min(scene.duration - 0.05, Math.max(0.6, scene.duration * 0.45));
    try { renderFrame(c.getContext('2d')!, project, starts[sceneIndex] + local, c.width, c.height); } catch (e) { console.error(e); }
  }, [project, sceneIndex, at, scene]);
  return <canvas ref={ref} className={className ?? 'w-full h-full object-contain'} />;
}

export default function Storyboard() {
  const project = useStore(s => s.current)!;
  const [busy, setBusy] = useState<string | null>(null);
  const [regenText, setRegenText] = useState<Record<string, string>>({});

  if (!project.scenes.length) return <div className="h-full grid place-items-center text-ink-400"><div className="text-center"><p>No scenes yet.</p><button className="btn-primary mt-3" onClick={() => setView('script')}>Write a script</button></div></div>;

  const move = (i: number, dir: -1 | 1) => commit(p => { const s = [...p.scenes]; const j = i + dir; if (j < 0 || j >= s.length) return p; [s[i], s[j]] = [s[j], s[i]]; return { ...p, scenes: s }; });
  const dup = (i: number) => commit(p => { const src = p.scenes[i]; const copy: Scene = structuredClone(src); copy.id = uid('scn'); copy.title = `${src.title} (copy)`; for (const a of copy.actions) a.id = uid('act'); for (const d of copy.dialogue) d.id = uid('dlg'); return { ...p, scenes: [...p.scenes.slice(0, i + 1), copy, ...p.scenes.slice(i + 1)] }; });
  const del = (i: number) => commit(p => ({ ...p, scenes: p.scenes.filter((_, k) => k !== i) }));
  const add = (i: number) => commit(p => { const s = makeScene(`Scene ${p.scenes.length + 1}`, { background: p.scenes[i]?.background ?? 'white', characters: p.scenes[i]?.characters.map(c => ({ ...c })) ?? [] }); return { ...p, scenes: [...p.scenes.slice(0, i + 1), s, ...p.scenes.slice(i + 1)] }; });
  const regen = async (i: number) => {
    setBusy(project.scenes[i].id);
    try { const r = await regenerateScene(i, regenText[project.scenes[i].id] || undefined); reportGeneration(r); }
    catch (e: any) { toast('error', e.message); } finally { setBusy(null); }
  };
  const openInEditor = (i: number) => { selectScene(i); seek(sceneStartTimes(project)[i] + 0.55); setView('editor'); };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{project.name}</h2>
            <p className="text-sm text-ink-400">{project.scenes.length} scenes · {project.scenes.reduce((a, s) => a + s.duration, 0).toFixed(1)}s · {project.characters.map(c => c.name).join(', ')}</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setView('script')}><Icon.Left size={14} /> Script</button>
            <button className="btn-primary" onClick={() => openInEditor(0)}>Open in editor <Icon.Right size={14} /></button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {project.scenes.map((sc, i) => (
            <div key={sc.id} className="card overflow-hidden flex flex-col">
              <div className="flex">
                <button className="w-[280px] shrink-0 bg-black/40 grid place-items-center relative" onClick={() => openInEditor(i)} title="Open in editor">
                  <SceneThumb project={project} sceneIndex={i} className="w-full max-h-[200px] object-contain" />
                  <span className="absolute top-2 left-2 text-[10px] font-bold bg-accent-500 text-ink-950 px-1.5 py-0.5 rounded">#{i + 1}</span>
                  <span className="absolute bottom-2 right-2 text-[10px] bg-black/60 px-1.5 py-0.5 rounded">{sc.duration.toFixed(1)}s</span>
                </button>
                <div className="flex-1 min-w-0 p-3">
                  <div className="flex items-center gap-2">
                    <input className="input !py-1 !bg-transparent !border-transparent hover:!border-ink-700 font-semibold" value={sc.title} onChange={e => updateScene(i, s => ({ ...s, title: e.target.value }))} />
                    <div className="flex gap-0.5 shrink-0">
                      <button className="btn-ghost !p-1.5" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon.Up size={13} /></button>
                      <button className="btn-ghost !p-1.5" title="Move down" disabled={i === project.scenes.length - 1} onClick={() => move(i, 1)}><Icon.Down size={13} /></button>
                      <button className="btn-ghost !p-1.5" title="Duplicate" onClick={() => dup(i)}><Icon.Copy size={13} /></button>
                      <button className="btn-ghost !p-1.5" title="Add scene after" onClick={() => add(i)}><Icon.Plus size={13} /></button>
                      <button className="btn-danger !p-1.5" title="Delete" onClick={() => { if (confirm('Delete this scene?')) del(i); }}><Icon.Trash size={13} /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <label className="block"><span className="label">Duration (s)</span><input type="number" step="0.5" min="1" className="input !py-1 mt-0.5" value={sc.duration} onChange={e => updateScene(i, s => ({ ...s, duration: Math.max(1, Number(e.target.value) || 1) }))} /></label>
                    <label className="block"><span className="label">Background</span><select className="input !py-1 mt-0.5" value={sc.background} onChange={e => updateScene(i, s => ({ ...s, background: e.target.value as any }))}>{BACKGROUNDS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
                    <label className="block"><span className="label">Camera</span><div className="flex gap-1 mt-0.5"><select className="input !py-1" value={sc.camera.shot} onChange={e => updateScene(i, s => ({ ...s, camera: { ...s.camera, shot: e.target.value as any } }))}><option value="wide">Wide</option><option value="medium">Medium</option><option value="closeup">Close-up</option></select><select className="input !py-1" value={sc.camera.move} onChange={e => updateScene(i, s => ({ ...s, camera: { ...s.camera, move: e.target.value as any } }))}>{['static', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'track'].map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</select></div></label>
                    <label className="block"><span className="label">Transition in</span><select className="input !py-1 mt-0.5" value={sc.transitionIn} onChange={e => updateScene(i, s => ({ ...s, transitionIn: e.target.value as Transition }))}>{['cut', 'fade', 'slide', 'wipe', 'zoom'].map(t => <option key={t} value={t}>{t}</option>)}</select></label>
                  </div>
                </div>
              </div>
              <div className="border-t border-ink-800 p-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="label mb-1">Characters & actions</div>
                  <div className="flex flex-wrap gap-1 mb-1.5">{sc.characters.map(c => { const ch = project.characters.find(x => x.id === c.characterId); return ch ? <span key={c.characterId} className="px-1.5 py-0.5 rounded-md border text-[11px]" style={{ borderColor: ch.color, color: ch.color }}>{ch.name}</span> : null; })}{sc.props.map(p => <span key={p.id} className="px-1.5 py-0.5 rounded-md bg-ink-800 text-ink-300 text-[11px]">{p.type}</span>)}</div>
                  <ul className="space-y-0.5 max-h-36 overflow-auto pr-1">
                    {[...sc.actions].sort((a, b) => a.start - b.start).map(a => { const ch = project.characters.find(c => c.id === a.characterId); return (
                      <li key={a.id} className="flex items-center gap-1.5">
                        <span className="text-ink-500 w-10 font-mono">{a.start.toFixed(1)}s</span>
                        <span style={{ color: ch?.color }} className="font-medium">{ch?.name}</span>
                        <select className="bg-transparent text-ink-200 border-b border-ink-700 text-[11px]" value={a.action} onChange={e => updateScene(i, s => ({ ...s, actions: s.actions.map(x => x.id === a.id ? { ...x, action: e.target.value as any } : x) }))}>{ACTIONS.map(x => <option key={x.name} value={x.name}>{x.label}</option>)}</select>
                        {a.emotion && <span className="text-ink-400 italic">{a.emotion}</span>}
                        <button className="ml-auto text-ink-500 hover:text-coral" onClick={() => updateScene(i, s => ({ ...s, actions: s.actions.filter(x => x.id !== a.id) }))}><Icon.X size={11} /></button>
                      </li>); })}
                    {!sc.actions.length && <li className="text-ink-500">No actions. Add some in the editor.</li>}
                  </ul>
                </div>
                <div>
                  <div className="label mb-1">Dialogue & narration</div>
                  <ul className="space-y-1 max-h-36 overflow-auto pr-1">
                    {[...sc.dialogue].sort((a, b) => a.start - b.start).map(d => { const ch = project.characters.find(c => c.id === d.characterId); return (
                      <li key={d.id} className="flex items-start gap-1.5">
                        <span className="text-ink-500 w-10 font-mono shrink-0">{d.start.toFixed(1)}s</span>
                        <span className="font-medium shrink-0" style={{ color: ch?.color ?? '#ffe9a8' }}>{ch?.name ?? 'Narrator'}:</span>
                        <input className="bg-transparent border-b border-ink-700 flex-1 min-w-0 text-ink-200" value={d.text} onChange={e => updateScene(i, s => ({ ...s, dialogue: s.dialogue.map(x => x.id === d.id ? { ...x, text: e.target.value } : x) }))} />
                        <button className="text-ink-500 hover:text-coral" onClick={() => updateScene(i, s => ({ ...s, dialogue: s.dialogue.filter(x => x.id !== d.id) }))}><Icon.X size={11} /></button>
                      </li>); })}
                    {!sc.dialogue.length && <li className="text-ink-500">No dialogue.</li>}
                  </ul>
                  <div className="mt-2 flex gap-1">
                    <input className="input !py-1 text-xs" placeholder={sc.sourceText ? 'Regenerate from source text, or describe changes…' : 'Describe this scene to generate it…'} value={regenText[sc.id] ?? ''} onChange={e => setRegenText({ ...regenText, [sc.id]: e.target.value })} />
                    <button className="btn-ghost !py-1 shrink-0" disabled={busy === sc.id} onClick={() => regen(i)} title="Regenerate only this scene"><Icon.Refresh size={13} className={busy === sc.id ? 'animate-spin' : ''} /> Regenerate</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button className="btn-ghost mt-4 w-full justify-center py-3" onClick={() => add(project.scenes.length - 1)}><Icon.Plus size={14} /> Add scene</button>
      </div>
    </div>
  );
}
