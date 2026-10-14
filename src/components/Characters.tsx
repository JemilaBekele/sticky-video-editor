import { useEffect, useRef, useState } from 'react';
import { useStore, commit, select, toast } from '../store/store';
import { type Character, type ActionName, ACTIONS, makeCharacter, uid } from '../types';
import { ACTION_DEFS } from '../engine/actions';
import { solve, drawStickman, IDLE } from '../engine/rig';
import { Icon } from '../ui/icons';
import { CharacterAvatar } from './editor/LeftPanel';

const LS_LIB = 'sticky-motion:character-library';

/** Character studio: customize rigs and preview every action in isolation. */
export default function CharactersView() {
  const project = useStore(s => s.current)!;
  const [sel, setSel] = useState<string | null>(project.characters[0]?.id ?? null);
  const [action, setAction] = useState<ActionName>('wave');
  const [lib, setLib] = useState<Character[]>(() => { try { return JSON.parse(localStorage.getItem(LS_LIB) ?? '[]'); } catch { return []; } });
  const ch = project.characters.find(c => c.id === sel) ?? project.characters[0];
  useEffect(() => { if (!ch && project.characters[0]) setSel(project.characters[0].id); }, [ch, project.characters]);

  const setC = (patch: Partial<Character>) => ch && commit(p => ({ ...p, characters: p.characters.map(c => c.id === ch.id ? { ...c, ...patch } : c) }));
  const saveToLib = () => { if (!ch) return; const next = [{ ...ch, id: uid('lib') }, ...lib.filter(l => l.name !== ch.name)].slice(0, 30); setLib(next); localStorage.setItem(LS_LIB, JSON.stringify(next)); toast('success', `${ch.name} saved to your character library`); };
  const addFromLib = (c: Character) => { const nc = { ...c, id: uid('chr') }; commit(p => ({ ...p, characters: [...p.characters, nc] })); setSel(nc.id); };

  return (
    <div className="h-full flex">
      <div className="w-[260px] border-r border-ink-800 bg-ink-900 overflow-auto p-2 space-y-1">
        <div className="label px-1 mb-1">Project characters</div>
        {project.characters.map(c => <button key={c.id} onClick={() => setSel(c.id)} className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs ${c.id === ch?.id ? 'bg-ink-800' : 'hover:bg-ink-850'}`}><CharacterAvatar ch={c} size={36} /><span className="font-medium" style={{ color: c.color }}>{c.name}</span></button>)}
        <button className="btn-ghost w-full justify-center mt-1" onClick={() => { const c = makeCharacter(`Stickman ${project.characters.length + 1}`, project.characters.length); commit(p => ({ ...p, characters: [...p.characters, c] })); setSel(c.id); }}><Icon.Plus size={13} /> New character</button>
        <div className="label px-1 mt-4 mb-1">Saved library</div>
        {lib.length === 0 && <div className="text-ink-500 text-xs px-1">Save a character to reuse it in other projects.</div>}
        {lib.map(c => <div key={c.id} className="flex items-center gap-2 px-2 py-1 rounded-md text-xs hover:bg-ink-850"><CharacterAvatar ch={c} size={32} /><span className="flex-1 truncate" style={{ color: c.color }}>{c.name}</span><button className="btn-ghost !p-1" title="Add to project" onClick={() => addFromLib(c)}><Icon.Plus size={11} /></button><button className="btn-ghost !p-1" title="Remove from library" onClick={() => { const n = lib.filter(l => l.id !== c.id); setLib(n); localStorage.setItem(LS_LIB, JSON.stringify(n)); }}><Icon.X size={11} /></button></div>)}
      </div>
      {ch ? (
        <div className="flex-1 min-w-0 flex">
          <div className="flex-1 flex flex-col">
            <div className="flex-1 min-h-0 bg-[radial-gradient(circle_at_center,#141826_0%,#0a0c12_70%)] grid place-items-center"><ActionPreview ch={ch} action={action} /></div>
            <div className="border-t border-ink-800 p-3 bg-ink-900">
              <div className="label mb-1.5">Preview action — all {ACTIONS.length} supported movements</div>
              <div className="flex flex-wrap gap-1">{ACTIONS.map(a => <button key={a.name} onClick={() => setAction(a.name)} className={`px-2 py-0.5 rounded-full text-[11px] border ${action === a.name ? 'bg-accent-500 text-ink-950 border-accent-500' : 'border-ink-700 text-ink-300 hover:bg-ink-800'}`}>{a.label}</button>)}</div>
            </div>
          </div>
          <div className="w-[300px] border-l border-ink-800 bg-ink-900 p-3 overflow-auto text-xs space-y-3">
            <div className="flex gap-2"><button className="btn-primary flex-1 justify-center" onClick={saveToLib}><Icon.Download size={13} /> Save to library</button><button className="btn-ghost" onClick={() => { select(ch.id); }} title="Select in editor"><Icon.Edit size={13} /></button></div>
            <div className="card p-2.5 space-y-2">
              <label className="block"><span className="label">Name</span><input className="input !py-1" value={ch.name} onChange={e => setC({ name: e.target.value })} /></label>
              <div className="flex gap-2"><label className="flex-1"><span className="label">Line color</span><input type="color" className="input !p-0.5 h-8" value={ch.color} onChange={e => setC({ color: e.target.value })} /></label><label className="flex-1"><span className="label">Head fill</span><div className="flex gap-1"><input type="color" className="input !p-0.5 h-8" value={ch.headColor ?? '#000000'} onChange={e => setC({ headColor: e.target.value })} /><button className="btn-ghost !px-2" onClick={() => setC({ headColor: undefined })}>∅</button></div></label></div>
              <Range label="Line thickness" min={2} max={10} step={0.5} value={ch.lineWidth} onChange={v => setC({ lineWidth: v })} />
              <Range label="Overall size" min={0.6} max={1.6} step={0.05} value={ch.scale} onChange={v => setC({ scale: v })} />
              <Range label="Head" min={0.07} max={0.16} step={0.005} value={ch.proportions.headRadius} onChange={v => setC({ proportions: { ...ch.proportions, headRadius: v } })} />
              <Range label="Torso" min={0.2} max={0.4} step={0.01} value={ch.proportions.torso} onChange={v => setC({ proportions: { ...ch.proportions, torso: v } })} />
              <Range label="Arms" min={0.1} max={0.25} step={0.01} value={ch.proportions.upperArm} onChange={v => setC({ proportions: { ...ch.proportions, upperArm: v, lowerArm: v * 0.95 } })} />
              <Range label="Legs" min={0.12} max={0.28} step={0.01} value={ch.proportions.upperLeg} onChange={v => setC({ proportions: { ...ch.proportions, upperLeg: v, lowerLeg: v } })} />
              <label className="flex items-center justify-between"><span>Facial features</span><input type="checkbox" checked={ch.face} onChange={e => setC({ face: e.target.checked })} /></label>
              <div><span className="label">Accessories</span><div className="flex flex-wrap gap-1 mt-1">{(['sunglasses', 'glasses', 'hat', 'cap', 'crown', 'tie', 'bow', 'scarf', 'headphones'] as const).map(a => <button key={a} onClick={() => setC({ accessories: ch.accessories.includes(a) ? ch.accessories.filter(x => x !== a) : [...ch.accessories, a] })} className={`px-2 py-0.5 rounded-full border text-[11px] ${ch.accessories.includes(a) ? 'bg-accent-500 text-ink-950 border-accent-500' : 'border-ink-600 text-ink-300'}`}>{a}</button>)}</div></div>
            </div>
            <button className="btn-danger w-full justify-center" onClick={() => { if (!confirm(`Delete ${ch.name}?`)) return; commit(p => ({ ...p, characters: p.characters.filter(c => c.id !== ch.id), scenes: p.scenes.map(s => ({ ...s, characters: s.characters.filter(c => c.characterId !== ch.id), actions: s.actions.filter(a => a.characterId !== ch.id), dialogue: s.dialogue.filter(d => d.characterId !== ch.id) })) })); setSel(null); }}><Icon.Trash size={12} /> Delete character</button>
          </div>
        </div>
      ) : <div className="flex-1 grid place-items-center text-ink-400">Create a character to get started.</div>}
    </div>
  );
}

function Range({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return <label className="block"><div className="flex justify-between"><span className="label">{label}</span><span className="text-ink-400">{value.toFixed(2)}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full" /></label>;
}

/** Loops a single action on a stickman — a direct view into the animation library. */
function ActionPreview({ ch, action }: { ch: Character; action: ActionName }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return; const ctx = c.getContext('2d')!;
    const def = ACTION_DEFS[action]; const dur = ACTIONS.find(a => a.name === action)!.defaultDuration + 0.6;
    const t0 = performance.now(); let raf = 0;
    const loop = () => {
      const sec = ((performance.now() - t0) / 1000) % dur;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, c.height * 0.85); ctx.lineTo(c.width, c.height * 0.85); ctx.stroke();
      const inAction = sec < dur - 0.6;
      const pose = inAction ? def.fn(Math.min(1, sec / (dur - 0.6)), sec, { intensity: 1, speed: 1 }) : (def.leaves === 'lying' ? def.fn(1, dur, { intensity: 1, speed: 1 }) : def.leaves === 'sitting' ? def.fn(1, dur, { intensity: 1, speed: 1 }) : IDLE);
      let x = c.width / 2;
      if (def.locomotion) x = c.width * (0.2 + 0.6 * Math.min(1, sec / (dur - 0.6)));
      const sk = solve(ch, pose, x, c.height * 0.85, c.height * 0.55, 1);
      drawStickman(ctx, ch, pose, sk, { time: sec });
      ctx.fillStyle = '#999'; ctx.font = '14px Inter, sans-serif'; ctx.fillText(`${action} · ${sec.toFixed(2)}s · mask: ${def.mask}${def.locomotion ? ' · moves' : ''}${def.leaves ? ` · leaves ${def.leaves}` : ''}`, 12, 24);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ch, action]);
  return <canvas ref={ref} width={720} height={450} className="rounded-lg shadow-2xl max-w-full max-h-full" />;
}
