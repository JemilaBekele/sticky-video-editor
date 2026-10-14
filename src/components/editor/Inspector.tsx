import { useEffect, useRef, useState } from 'react';
import { useStore, commit, updateScene, select, toast } from '../../store/store';
import { useCurrentSceneIndex } from './Preview';
import { type Character, type Emotion, type Accessory, type Transition, ACTIONS, BACKGROUNDS, PROP_TYPES, uid } from '../../types';
import { Section, Slider, Toggle, CharacterAvatar, audioDuration } from './LeftPanel';
import { blobToDataUrl } from '../../store/server';
import { VOICES, speechDuration } from '../../engine/voice';
import { availableVoices, type NeuralVoice } from '../../engine/neural';
import { voiceLines } from '../../store/generate';
import { refresh, seek } from '../../store/playback';
import { Icon } from '../../ui/icons';
import { sceneStartTimes } from '../../types';

const EMOTIONS: Emotion[] = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'confused', 'scared', 'smug', 'embarrassed'];
const ACCS: Accessory[] = ['sunglasses', 'glasses', 'hat', 'cap', 'crown', 'tie', 'bow', 'scarf', 'headphones'];

export default function Inspector() {
  const project = useStore(s => s.current)!;
  const selectedId = useStore(s => s.selectedId);
  const cur = useCurrentSceneIndex();
  const scene = project.scenes[cur];
  if (!scene) return <Panel><Empty text="No scene" /></Panel>;

  if (selectedId === 'camera') return <Panel title="Camera"><CameraInspector cur={cur} /></Panel>;
  const ch = project.characters.find(c => c.id === selectedId);
  if (ch) return <Panel title={`Character · ${ch.name}`}><CharacterInspector ch={ch} cur={cur} /></Panel>;
  const prop = scene.props.find(p => p.id === selectedId);
  if (prop) return <Panel title={`Prop · ${prop.type}`}><PropInspector cur={cur} id={prop.id} /></Panel>;
  const clip = scene.actions.find(a => a.id === selectedId);
  if (clip) return <Panel title="Action clip"><ClipInspector cur={cur} id={clip.id} /></Panel>;
  const line = scene.dialogue.find(d => d.id === selectedId);
  if (line) return <Panel title={line.characterId === 'narrator' ? 'Narration' : 'Dialogue'}><DialogueInspector cur={cur} id={line.id} /></Panel>;
  const txt = scene.texts.find(t => t.id === selectedId);
  if (txt) return <Panel title="Text overlay"><TextInspector cur={cur} id={txt.id} /></Panel>;
  const sfx = scene.sfx.find(s => s.id === selectedId);
  if (sfx) return <Panel title="Sound effect"><SfxInspector cur={cur} id={sfx.id} /></Panel>;
  return <Panel title={`Scene ${cur + 1}`}><SceneInspector cur={cur} /></Panel>;
}

function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return <div className="h-full flex flex-col w-[280px] shrink-0 bg-ink-900 border-l border-ink-800"><div className="panel-title flex items-center justify-between">{title ?? 'Properties'}<button className="text-ink-500 hover:text-white" onClick={() => select('scene')} title="Back to scene"><Icon.X size={12} /></button></div><div className="flex-1 overflow-auto p-2 space-y-2 text-xs">{children}</div></div>;
}
const Empty = ({ text }: { text: string }) => <div className="text-ink-500 p-3 text-center">{text}</div>;
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block"><span className="label">{label}</span><div className="mt-0.5">{children}</div></label>;

function SceneInspector({ cur }: { cur: number }) {
  const project = useStore(s => s.current)!;
  const s = project.scenes[cur];
  return (<>
    <Section title="Scene">
      <Field label="Title"><input className="input !py-1" value={s.title} onChange={e => updateScene(cur, x => ({ ...x, title: e.target.value }))} /></Field>
      <div className="grid grid-cols-2 gap-2 mt-1">
        <Field label="Duration (s)"><input type="number" step="0.5" min="1" className="input !py-1" value={s.duration} onChange={e => updateScene(cur, x => ({ ...x, duration: Math.max(1, Number(e.target.value) || 1) }))} /></Field>
        <Field label="Transition in"><select className="input !py-1" value={s.transitionIn} onChange={e => updateScene(cur, x => ({ ...x, transitionIn: e.target.value as Transition }))}>{['cut', 'fade', 'slide', 'wipe', 'zoom'].map(t => <option key={t}>{t}</option>)}</select></Field>
      </div>
      <Field label="Background"><select className="input !py-1" value={s.background} onChange={e => updateScene(cur, x => ({ ...x, background: e.target.value as any }))}>{BACKGROUNDS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></Field>
      <button className="btn-ghost w-full justify-center mt-2" onClick={() => select('camera')}><Icon.Camera size={13} /> Camera settings</button>
    </Section>
    <Section title="In this scene">
      {s.characters.map(c => { const ch = project.characters.find(x => x.id === c.characterId); return ch ? <button key={c.characterId} className="flex items-center gap-2 w-full px-1 py-0.5 rounded hover:bg-ink-800" onClick={() => select(ch.id)}><span className="w-2 h-2 rounded-full" style={{ background: ch.color }} />{ch.name}<span className="ml-auto text-ink-500">x {c.x.toFixed(2)}</span></button> : null; })}
      {s.props.map(p => <button key={p.id} className="flex items-center gap-2 w-full px-1 py-0.5 rounded hover:bg-ink-800" onClick={() => select(p.id)}><Icon.Box size={11} />{p.type}</button>)}
      {!s.characters.length && !s.props.length && <div className="text-ink-500">Empty scene. Add characters & props from the left panel.</div>}
    </Section>
    <Section title="Source text"><textarea className="input !py-1 h-20 text-[11px]" value={s.sourceText ?? ''} onChange={e => updateScene(cur, x => ({ ...x, sourceText: e.target.value }))} placeholder="Script fragment this scene was generated from" /></Section>
  </>);
}

function CameraInspector({ cur }: { cur: number }) {
  const project = useStore(s => s.current)!;
  const s = project.scenes[cur]; const c = s.camera;
  const set = (patch: Partial<typeof c>) => updateScene(cur, x => ({ ...x, camera: { ...x.camera, ...patch } }));
  return (<Section title="Camera plan">
    <Field label="Shot"><select className="input !py-1" value={c.shot} onChange={e => set({ shot: e.target.value as any })}><option value="wide">Wide shot</option><option value="medium">Medium shot</option><option value="closeup">Close-up</option></select></Field>
    <Field label="Movement"><select className="input !py-1 mt-1" value={c.move} onChange={e => set({ move: e.target.value as any })}>{[['static', 'Static'], ['zoom_in', 'Zoom in'], ['zoom_out', 'Zoom out'], ['pan_left', 'Pan left'], ['pan_right', 'Pan right'], ['track', 'Tracking shot (follow)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
    <Field label="Focus character"><select className="input !py-1 mt-1" value={c.focusCharacterId ?? ''} onChange={e => set({ focusCharacterId: e.target.value || undefined })}><option value="">(auto)</option>{s.characters.map(sc => { const ch = project.characters.find(x => x.id === sc.characterId); return ch ? <option key={ch.id} value={ch.id}>{ch.name}</option> : null; })}</select></Field>
    <div className="grid grid-cols-2 gap-2 mt-1"><Field label="Move starts at (s)"><input type="number" step="0.1" min="0" className="input !py-1" value={c.startAt ?? 0} onChange={e => set({ startAt: Number(e.target.value) })} /></Field><Field label="Intensity"><input type="number" step="0.1" min="0.1" max="2" className="input !py-1" value={c.intensity ?? 1} onChange={e => set({ intensity: Number(e.target.value) })} /></Field></div>
    <p className="text-ink-500 mt-2">Impact shakes (falls, fights) are added automatically.</p>
  </Section>);
}

function CharacterInspector({ ch, cur }: { ch: Character; cur: number }) {
  const project = useStore(s => s.current)!;
  const scene = project.scenes[cur];
  const sc = scene.characters.find(c => c.characterId === ch.id);
  const setC = (patch: Partial<Character>) => commit(p => ({ ...p, characters: p.characters.map(c => c.id === ch.id ? { ...c, ...patch } : c) }));
  const setP = (patch: Partial<Character['proportions']>) => setC({ proportions: { ...ch.proportions, ...patch } });
  const setSC = (patch: Partial<NonNullable<typeof sc>>) => updateScene(cur, s => ({ ...s, characters: s.characters.map(c => c.characterId === ch.id ? { ...c, ...patch } : c) }));
  return (<>
    <Section title="Identity">
      <div className="flex items-center gap-2"><CharacterAvatar ch={ch} size={56} /><div className="flex-1"><Field label="Name"><input className="input !py-1" value={ch.name} onChange={e => setC({ name: e.target.value })} /></Field><div className="flex gap-1 mt-1"><input type="color" className="input !p-0.5 h-8 w-10" value={ch.color} onChange={e => setC({ color: e.target.value })} title="Line color" /><input type="color" className="input !p-0.5 h-8 w-10" value={ch.headColor ?? '#000000'} onChange={e => setC({ headColor: e.target.value })} title="Head fill" /><button className="btn-ghost !py-1 !px-2" onClick={() => setC({ headColor: undefined })} title="No head fill">∅</button></div></div></div>
      <Slider label="Line thickness" min={2} max={10} step={0.5} value={ch.lineWidth} onChange={v => setC({ lineWidth: v })} />
      <Slider label="Size" min={0.6} max={1.6} step={0.05} value={ch.scale} onChange={v => setC({ scale: v })} />
      <Toggle label="Facial features" value={ch.face} onChange={v => setC({ face: v })} />
    </Section>
    <Section title="Proportions">
      <Slider label="Head" min={0.07} max={0.16} step={0.005} value={ch.proportions.headRadius} onChange={v => setP({ headRadius: v })} />
      <Slider label="Torso" min={0.2} max={0.4} step={0.01} value={ch.proportions.torso} onChange={v => setP({ torso: v })} />
      <Slider label="Arms" min={0.1} max={0.25} step={0.01} value={ch.proportions.upperArm} onChange={v => setP({ upperArm: v, lowerArm: v * 0.95 })} />
      <Slider label="Legs" min={0.12} max={0.28} step={0.01} value={ch.proportions.upperLeg} onChange={v => setP({ upperLeg: v, lowerLeg: v })} />
    </Section>
    <Section title="Accessories">
      <div className="flex flex-wrap gap-1">{ACCS.map(a => <button key={a} onClick={() => setC({ accessories: ch.accessories.includes(a) ? ch.accessories.filter(x => x !== a) : [...ch.accessories, a] })} className={`px-2 py-0.5 rounded-full border text-[11px] ${ch.accessories.includes(a) ? 'bg-accent-500 text-ink-950 border-accent-500' : 'border-ink-600 text-ink-300'}`}>{a}</button>)}</div>
      <p className="text-ink-500 mt-1">Accessories persist across all scenes.</p>
    </Section>
    <Section title="Voice">
      <div className="grid grid-cols-2 gap-2"><Field label="Voice"><VoicePicker ch={ch} onChange={async voice => { setC({ voice }); refresh(); if (voice.startsWith('n:')) { try { const n = await voiceLines({ characterId: ch.id }); if (n) toast('success', `Re-recorded ${n} line${n > 1 ? 's' : ''} in the new voice`); } catch (e: any) { toast('error', e.message); } } }} /></Field><Field label="Pitch"><input type="number" step="0.1" min="0.5" max="2" className="input !py-1" value={ch.pitch} onChange={e => setC({ pitch: Number(e.target.value) })} /></Field></div>
    </Section>
    {sc ? (
      <Section title="Placement in this scene">
        <Slider label="Position (x)" min={0} max={1} step={0.01} value={sc.x} onChange={v => setSC({ x: v })} />
        <div className="grid grid-cols-2 gap-2 mt-1"><Field label="Facing"><select className="input !py-1" value={sc.facing} onChange={e => setSC({ facing: Number(e.target.value) as 1 | -1 })}><option value={1}>Right →</option><option value={-1}>← Left</option></select></Field><Field label="Mood at start"><select className="input !py-1" value={sc.initialEmotion ?? 'neutral'} onChange={e => setSC({ initialEmotion: e.target.value as Emotion })}>{EMOTIONS.map(e => <option key={e}>{e}</option>)}</select></Field></div>
        <Toggle label="Visible" value={sc.visible} onChange={v => setSC({ visible: v })} />
        <div className="flex gap-1 mt-2">
          <select className="input !py-1" defaultValue="" onChange={e => { if (!e.target.value) return; const a = ACTIONS.find(x => x.name === e.target.value)!; const start = Math.max(0, ...scene.actions.filter(x => x.characterId === ch.id).map(x => x.start + x.duration), 0.3); const id = uid('act'); updateScene(cur, s => ({ ...s, actions: [...s.actions, { id, characterId: ch.id, action: a.name, start, duration: a.defaultDuration }], duration: Math.max(s.duration, start + a.defaultDuration + 0.3) })); select(id); e.target.value = ''; }}><option value="">+ Add action…</option>{ACTIONS.map(a => <option key={a.name} value={a.name}>{a.label}</option>)}</select>
        </div>
        <button className="btn-danger w-full justify-center mt-2" onClick={() => { updateScene(cur, s => ({ ...s, characters: s.characters.filter(c => c.characterId !== ch.id), actions: s.actions.filter(a => a.characterId !== ch.id) })); select('scene'); }}>Remove from scene</button>
      </Section>
    ) : <button className="btn-ghost w-full justify-center" onClick={() => updateScene(cur, s => ({ ...s, characters: [...s.characters, { characterId: ch.id, x: 0.5, facing: 1, visible: true }] }))}>Add to this scene</button>}
    <button className="btn-danger w-full justify-center" onClick={() => { if (!confirm(`Delete ${ch.name} from the whole project?`)) return; commit(p => ({ ...p, characters: p.characters.filter(c => c.id !== ch.id), scenes: p.scenes.map(s => ({ ...s, characters: s.characters.filter(c => c.characterId !== ch.id), actions: s.actions.filter(a => a.characterId !== ch.id), dialogue: s.dialogue.filter(d => d.characterId !== ch.id) })) })); select(null); }}><Icon.Trash size={12} /> Delete character</button>
  </>);
}

function PropInspector({ cur, id }: { cur: number; id: string }) {
  const project = useStore(s => s.current)!;
  const p = project.scenes[cur].props.find(x => x.id === id)!;
  const set = (patch: Partial<typeof p>) => updateScene(cur, s => ({ ...s, props: s.props.map(x => x.id === id ? { ...x, ...patch } : x) }));
  return (<Section title="Prop">
    <Field label="Type"><select className="input !py-1" value={p.type} onChange={e => set({ type: e.target.value as any })}>{PROP_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
    <Slider label="Position (x)" min={0} max={1} step={0.01} value={p.x} onChange={v => set({ x: v })} />
    <Slider label="Height (y)" min={0} max={0.6} step={0.01} value={p.y} onChange={v => set({ y: v })} />
    <Slider label="Scale" min={0.3} max={2.5} step={0.05} value={p.scale} onChange={v => set({ scale: v })} />
    {p.type === 'sign' && <Field label="Sign text"><input className="input !py-1" value={p.label ?? ''} onChange={e => set({ label: e.target.value })} /></Field>}
    <p className="text-ink-500 mt-1">Drag on the canvas to move. Use a “pick up” action with this prop as target to make it follow a hand.</p>
    <button className="btn-danger w-full justify-center mt-2" onClick={() => { updateScene(cur, s => ({ ...s, props: s.props.filter(x => x.id !== id) })); select('scene'); }}><Icon.Trash size={12} /> Remove prop</button>
  </Section>);
}

function ClipInspector({ cur, id }: { cur: number; id: string }) {
  const project = useStore(s => s.current)!;
  const scene = project.scenes[cur];
  const a = scene.actions.find(x => x.id === id)!;
  const set = (patch: Partial<typeof a>) => updateScene(cur, s => ({ ...s, actions: s.actions.map(x => x.id === id ? { ...x, ...patch } : x) }));
  const moves = ACTIONS.find(x => x.name === a.action)?.moves;
  return (<Section title="Action">
    <div className="grid grid-cols-2 gap-2">
      <Field label="Character"><select className="input !py-1" value={a.characterId} onChange={e => set({ characterId: e.target.value })}>{scene.characters.map(c => { const ch = project.characters.find(x => x.id === c.characterId); return ch ? <option key={ch.id} value={ch.id}>{ch.name}</option> : null; })}</select></Field>
      <Field label="Action"><select className="input !py-1" value={a.action} onChange={e => set({ action: e.target.value as any })}>{ACTIONS.map(x => <option key={x.name} value={x.name}>{x.label}</option>)}</select></Field>
      <Field label="Start (s)"><input type="number" step="0.1" min="0" className="input !py-1" value={a.start} onChange={e => set({ start: Math.max(0, Number(e.target.value)) })} /></Field>
      <Field label="Duration (s)"><input type="number" step="0.1" min="0.2" className="input !py-1" value={a.duration} onChange={e => set({ duration: Math.max(0.2, Number(e.target.value)) })} /></Field>
      <Field label="Target"><select className="input !py-1" value={a.targetId ?? ''} onChange={e => set({ targetId: e.target.value || undefined })}><option value="">(none)</option>{scene.characters.filter(c => c.characterId !== a.characterId).map(c => { const ch = project.characters.find(x => x.id === c.characterId); return ch ? <option key={ch.id} value={ch.id}>{ch.name}</option> : null; })}{scene.props.map(p => <option key={p.id} value={p.id}>prop: {p.type}</option>)}</select></Field>
      <Field label="Emotion"><select className="input !py-1" value={a.emotion ?? ''} onChange={e => set({ emotion: (e.target.value || undefined) as any })}><option value="">(default)</option>{EMOTIONS.map(e => <option key={e}>{e}</option>)}</select></Field>
      {a.action === 'pickup' && <Field label="Prop"><select className="input !py-1" value={a.propId ?? ''} onChange={e => set({ propId: e.target.value || undefined })}><option value="">(none)</option>{scene.props.map(p => <option key={p.id} value={p.id}>{p.type}</option>)}</select></Field>}
      {moves && <Field label="Move to (x)"><input type="number" step="0.05" min="-0.2" max="1.2" className="input !py-1" value={a.toX ?? ''} placeholder="auto" onChange={e => set({ toX: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>}
      {a.action === 'turn' && <Field label="Face"><select className="input !py-1" value={a.facing ?? ''} onChange={e => set({ facing: (e.target.value ? Number(e.target.value) : undefined) as any })}><option value="">flip</option><option value={1}>right</option><option value={-1}>left</option></select></Field>}
    </div>
    <Slider label="Speed" min={0.3} max={3} step={0.1} value={a.speed ?? 1} onChange={v => set({ speed: v })} />
    <Slider label="Intensity" min={0.2} max={2} step={0.1} value={a.intensity ?? 1} onChange={v => set({ intensity: v })} />
    <div className="flex gap-1 mt-2">
      <button className="btn-ghost flex-1 justify-center" onClick={() => seek(sceneStartTimes(project)[cur] + a.start)}><Icon.Clock size={12} /> Go to</button>
      <button className="btn-ghost flex-1 justify-center" onClick={() => { const c = { ...a, id: uid('act'), start: a.start + a.duration }; updateScene(cur, s => ({ ...s, actions: [...s.actions, c] })); select(c.id); }}><Icon.Copy size={12} /> Duplicate</button>
      <button className="btn-danger flex-1 justify-center" onClick={() => { updateScene(cur, s => ({ ...s, actions: s.actions.filter(x => x.id !== id) })); select('scene'); }}><Icon.Trash size={12} /></button>
    </div>
  </Section>);
}

function DialogueInspector({ cur, id }: { cur: number; id: string }) {
  const project = useStore(s => s.current)!;
  const scene = project.scenes[cur];
  const d = scene.dialogue.find(x => x.id === id)!;
  const file = useRef<HTMLInputElement>(null);
  const recorder = useRecorder(async (url, seconds) => { set({ audioUrl: url, audioSource: 'recorded', duration: Math.max(0.8, Math.round((seconds + 0.2) * 10) / 10) }); refresh(); toast('success', 'Recording added to this line'); });
  const set = (patch: Partial<typeof d>) => { updateScene(cur, s => ({ ...s, dialogue: s.dialogue.map(x => x.id === id ? { ...x, ...patch } : x) })); };
  const ch = project.characters.find(c => c.id === d.characterId);
  return (<Section title="Line">
    <Field label="Speaker"><select className="input !py-1" value={d.characterId} onChange={e => set({ characterId: e.target.value, style: e.target.value === 'narrator' ? 'subtitle' : d.style === 'subtitle' ? 'bubble' : d.style })}><option value="narrator">Narrator</option>{project.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
    <Field label="Text"><textarea className="input !py-1 h-16" value={d.text} onChange={e => set({ text: e.target.value, audioUrl: undefined, duration: Math.max(d.duration, speechDuration(e.target.value, ch)) })} /></Field>
    <div className="grid grid-cols-2 gap-2 mt-1">
      <Field label="Start (s)"><input type="number" step="0.1" min="0" className="input !py-1" value={d.start} onChange={e => set({ start: Math.max(0, Number(e.target.value)) })} /></Field>
      <Field label="Duration (s)"><input type="number" step="0.1" min="0.3" className="input !py-1" value={d.duration} onChange={e => set({ duration: Math.max(0.3, Number(e.target.value)) })} /></Field>
      <Field label="Tone"><select className="input !py-1" value={d.tone ?? ''} onChange={e => set({ tone: (e.target.value || undefined) as any })}><option value="">(neutral)</option>{EMOTIONS.map(e => <option key={e}>{e}</option>)}</select></Field>
      <Field label="Display"><select className="input !py-1" value={d.style} onChange={e => set({ style: e.target.value as any })}><option value="bubble">Speech bubble</option><option value="thought">Thought bubble</option><option value="subtitle">Subtitle only</option></select></Field>
    </div>
    <div className="mt-2 flex items-center gap-1">
      <span className={`w-2 h-2 rounded-full ${d.audioUrl ? 'bg-mint' : 'bg-ink-500'}`} /><span className="text-ink-400 flex-1">{!d.audioUrl ? 'Built-in voice (robotic)' : d.audioSource === 'voice' ? 'Natural voice' : d.audioSource === 'recorded' ? 'Your recording' : 'Imported clip'}</span>
      {d.audioUrl && <audio src={d.audioUrl} controls className="h-6 w-28" />}
    </div>
    <div className="flex gap-1 mt-2">
      <button className={`flex-1 justify-center ${recorder.recording ? 'btn-danger' : 'btn-primary'}`} onClick={recorder.toggle}>{recorder.recording ? <><span className="w-2 h-2 rounded-full bg-white animate-pulse" /> Stop recording</> : <>● Record my voice</>}</button>
      <button className="btn-ghost justify-center" onClick={() => file.current?.click()} title="Import audio clip"><Icon.Upload size={12} /></button>
      {d.audioUrl && <button className="btn-ghost justify-center" onClick={() => { set({ audioUrl: undefined }); refresh(); }} title="Remove this audio"><Icon.X size={12} /></button>}
      <input ref={file} type="file" accept="audio/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 20e6) { toast('error', 'Clip too large (max 20 MB)'); return; } const url = await blobToDataUrl(f); const dur = await audioDuration(url); set({ audioUrl: url, audioSource: 'imported', duration: dur ? Math.round((dur + 0.2) * 10) / 10 : d.duration }); refresh(); e.target.value = ''; }} />
    </div>
    <div className="flex gap-1 mt-2">
      <button className="btn-ghost flex-1 justify-center" onClick={() => seek(sceneStartTimes(project)[cur] + d.start)}><Icon.Clock size={12} /> Go to</button>
      <button className="btn-danger flex-1 justify-center" onClick={() => { updateScene(cur, s => ({ ...s, dialogue: s.dialogue.filter(x => x.id !== id) })); select('scene'); }}><Icon.Trash size={12} /> Delete</button>
    </div>
  </Section>);
}

function TextInspector({ cur, id }: { cur: number; id: string }) {
  const project = useStore(s => s.current)!;
  const t = project.scenes[cur].texts.find(x => x.id === id)!;
  const set = (patch: Partial<typeof t>) => updateScene(cur, s => ({ ...s, texts: s.texts.map(x => x.id === id ? { ...x, ...patch } : x) }));
  return (<Section title="Text">
    <Field label="Text"><input className="input !py-1" value={t.text} onChange={e => set({ text: e.target.value })} /></Field>
    <div className="grid grid-cols-2 gap-2 mt-1">
      <Field label="Kind"><select className="input !py-1" value={t.kind} onChange={e => set({ kind: e.target.value as any })}>{['title', 'caption', 'sfx_text', 'closing'].map(k => <option key={k}>{k}</option>)}</select></Field>
      <Field label="Animation"><select className="input !py-1" value={t.animation} onChange={e => set({ animation: e.target.value as any })}>{['none', 'pop', 'slide', 'typewriter', 'shake'].map(k => <option key={k}>{k}</option>)}</select></Field>
      <Field label="Start (s)"><input type="number" step="0.1" min="0" className="input !py-1" value={t.start} onChange={e => set({ start: Number(e.target.value) })} /></Field>
      <Field label="Duration (s)"><input type="number" step="0.1" min="0.2" className="input !py-1" value={t.duration} onChange={e => set({ duration: Number(e.target.value) })} /></Field>
      <Field label="Color"><input type="color" className="input !p-0.5 h-8" value={t.color} onChange={e => set({ color: e.target.value })} /></Field>
    </div>
    <Slider label="Size" min={0.5} max={3} step={0.1} value={t.size} onChange={v => set({ size: v })} />
    <Slider label="X" min={0} max={1} step={0.01} value={t.x} onChange={v => set({ x: v })} />
    <Slider label="Y" min={0} max={1} step={0.01} value={t.y} onChange={v => set({ y: v })} />
    <button className="btn-danger w-full justify-center mt-2" onClick={() => { updateScene(cur, s => ({ ...s, texts: s.texts.filter(x => x.id !== id) })); select('scene'); }}><Icon.Trash size={12} /> Delete</button>
  </Section>);
}

function SfxInspector({ cur, id }: { cur: number; id: string }) {
  const project = useStore(s => s.current)!;
  const x = project.scenes[cur].sfx.find(s => s.id === id)!;
  const set = (patch: Partial<typeof x>) => { updateScene(cur, s => ({ ...s, sfx: s.sfx.map(y => y.id === id ? { ...y, ...patch } : y) })); refresh(); };
  return (<Section title="Sound effect">
    <Field label="Sound"><select className="input !py-1" value={x.name} onChange={e => set({ name: e.target.value as any })}>{['footsteps', 'door', 'impact', 'boing', 'whoosh', 'laugh_track', 'slip', 'ding', 'crash', 'gasp', 'cheer'].map(n => <option key={n}>{n}</option>)}</select></Field>
    <Field label="Time (s)"><input type="number" step="0.1" min="0" className="input !py-1" value={x.start} onChange={e => set({ start: Number(e.target.value) })} /></Field>
    <Slider label="Volume" value={x.volume} onChange={v => set({ volume: v })} />
    <button className="btn-danger w-full justify-center mt-2" onClick={() => { updateScene(cur, s => ({ ...s, sfx: s.sfx.filter(y => y.id !== id) })); select('scene'); }}><Icon.Trash size={12} /> Delete</button>
  </Section>);
}

/** Record a voice line from the microphone. Calls onDone with a data URL and the clip length in seconds. */
function useRecorder(onDone: (url: string, seconds: number) => void) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const live = useRef<{ rec: MediaRecorder; stream: MediaStream } | null>(null);
  // selecting something else while recording: turn the microphone off and discard the take
  useEffect(() => () => { const l = live.current; if (!l) return; l.rec.onstop = null; if (l.rec.state !== 'inactive') l.rec.stop(); l.stream.getTracks().forEach(t => t.stop()); live.current = null; }, []);
  const toggle = async () => {
    if (rec) { rec.stop(); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { toast('error', 'Microphone not available. Allow microphone access in the browser and try again.'); return; }
    const mr = new MediaRecorder(stream); const chunks: Blob[] = [];
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop()); setRec(null); live.current = null;
      const blob = new Blob(chunks, { type: mr.mimeType });
      try {
        // recorded WebM has no duration in its header, so measure it by decoding
        const ac = new AudioContext(); const buf = await ac.decodeAudioData(await blob.arrayBuffer()); await ac.close();
        onDone(await blobToDataUrl(blob), buf.duration);
      } catch { toast('error', 'The recording could not be read. Try again.'); }
    };
    mr.start(); setRec(mr); live.current = { rec: mr, stream };
  };
  return { recording: !!rec, toggle };
}

/** Natural voices (when installed) and the built-in robotic voices. */
function VoicePicker({ ch, onChange }: { ch: Character; onChange: (voice: string) => void }) {
  const [natural, setNatural] = useState<NeuralVoice[]>([]);
  useEffect(() => { availableVoices().then(setNatural); }, []);
  const known = natural.some(v => v.id === ch.voice) || VOICES.some(v => v.id === ch.voice);
  return (
    <select className="input !py-1" value={known ? ch.voice : ''} onChange={e => onChange(e.target.value)}>
      {!known && <option value="">(default)</option>}
      {natural.length > 0 && <optgroup label="Natural">{natural.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</optgroup>}
      <optgroup label="Built-in (robotic)">{VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</optgroup>
    </select>
  );
}
