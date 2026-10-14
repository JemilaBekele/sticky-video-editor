import { useEffect, useRef, useState } from 'react';
import { useStore, commit, updateScene, select, selectScene, toast, setView } from '../../store/store';
import { seek, refresh } from '../../store/playback';
import { useCurrentSceneIndex } from './Preview';
import { type BackgroundId, type PropType, BACKGROUNDS, PROP_TYPES, makeCharacter, makeScene, uid, sceneStartTimes } from '../../types';
import { drawBackground } from '../../engine/backgrounds';
import { drawProp, PROP_REL_SIZE } from '../../engine/props';
import { solve, drawStickman, IDLE } from '../../engine/rig';
import { Icon } from '../../ui/icons';
import { blobToDataUrl } from '../../store/server';
import { availableVoices } from '../../engine/neural';
import { LIBRARY } from '../../engine/music';
import { voiceLines } from '../../store/generate';

const TABS = ['Scenes', 'Characters', 'Backgrounds', 'Props', 'Audio', 'Text'] as const;

export default function LeftPanel() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Scenes');
  return (
    <div className="h-full flex flex-col bg-ink-900 border-r border-ink-800 w-[260px] shrink-0">
      <div className="grid grid-cols-3 border-b border-ink-800 text-[11px]">
        {TABS.map(t => <button key={t} onClick={() => setTab(t)} className={`py-2 ${tab === t ? 'text-white bg-ink-800' : 'text-ink-400 hover:text-white'}`}>{t}</button>)}
      </div>
      <div className="flex-1 overflow-auto p-2">
        {tab === 'Scenes' && <ScenesTab />}
        {tab === 'Characters' && <CharactersTab />}
        {tab === 'Backgrounds' && <BackgroundsTab />}
        {tab === 'Props' && <PropsTab />}
        {tab === 'Audio' && <AudioTab />}
        {tab === 'Text' && <TextTab />}
      </div>
    </div>
  );
}

function ScenesTab() {
  const project = useStore(s => s.current)!;
  const cur = useCurrentSceneIndex();
  const starts = sceneStartTimes(project);
  return (
    <div className="space-y-1">
      {project.scenes.map((s, i) => (
        <button key={s.id} onClick={() => { selectScene(i); seek(starts[i] + 0.55); select('scene'); }} className={`w-full text-left px-2 py-1.5 rounded-md text-xs border ${i === cur ? 'bg-ink-800 border-accent-500/50' : 'border-transparent hover:bg-ink-850'}`}>
          <div className="font-medium truncate">{i + 1}. {s.title}</div>
          <div className="text-ink-400">{s.duration.toFixed(1)}s · {s.background} · {s.actions.length} actions · {s.dialogue.length} lines</div>
        </button>
      ))}
      <button className="btn-ghost w-full justify-center mt-2" onClick={() => commit(p => ({ ...p, scenes: [...p.scenes, makeScene(`Scene ${p.scenes.length + 1}`, { background: p.scenes.at(-1)?.background ?? 'white', characters: p.scenes.at(-1)?.characters.map((c: any) => ({ ...c })) ?? [] })] }))}><Icon.Plus size={13} /> Add scene</button>
      <button className="btn-ghost w-full justify-center" onClick={() => setView('storyboard')}><Icon.Board size={13} /> Open storyboard</button>
    </div>
  );
}

export function CharacterAvatar({ ch, size = 48, action }: { ch: any; size?: number; action?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return; const ctx = c.getContext('2d')!; ctx.clearRect(0, 0, c.width, c.height);
    const sk = solve(ch, { ...IDLE, lShoulder: 2.6, lElbow: -0.6 }, c.width / 2, c.height * 0.95, c.height * 0.85 / ch.scale, 1);
    drawStickman(ctx, ch, { ...IDLE, lShoulder: 2.6, lElbow: -0.6, mouthShape: 'smile' }, sk, { time: 0 });
  }, [ch, action]);
  return <canvas ref={ref} width={size} height={size} />;
}

function CharactersTab() {
  const project = useStore(s => s.current)!;
  const cur = useCurrentSceneIndex();
  const scene = project.scenes[cur];
  const inScene = new Set(scene?.characters.map(c => c.characterId));
  return (
    <div className="space-y-1">
      {project.characters.map(ch => (
        <div key={ch.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-ink-850 text-xs">
          <button onClick={() => select(ch.id)} className="flex items-center gap-2 flex-1 min-w-0 text-left"><CharacterAvatar ch={ch} size={36} /><div className="min-w-0"><div className="font-medium truncate" style={{ color: ch.color }}>{ch.name}</div><div className="text-ink-400 truncate">{ch.accessories.join(', ') || 'no accessories'}</div></div></button>
          {scene && (inScene.has(ch.id)
            ? <button className="btn-ghost !px-1.5 !py-1" title="Remove from this scene" onClick={() => updateScene(cur, s => ({ ...s, characters: s.characters.filter(c => c.characterId !== ch.id), actions: s.actions.filter(a => a.characterId !== ch.id) }))}><Icon.X size={12} /></button>
            : <button className="btn-ghost !px-1.5 !py-1" title="Add to this scene" onClick={() => updateScene(cur, s => ({ ...s, characters: [...s.characters, { characterId: ch.id, x: s.characters.length ? 0.75 : 0.5, facing: s.characters.length ? -1 : 1, visible: true }] }))}><Icon.Plus size={12} /></button>)}
        </div>
      ))}
      <button className="btn-ghost w-full justify-center mt-2" onClick={() => { const ch = makeCharacter(`Stickman ${project.characters.length + 1}`, project.characters.length); commit(p => ({ ...p, characters: [...p.characters, ch] })); select(ch.id); }}><Icon.Plus size={13} /> New character</button>
      <button className="btn-ghost w-full justify-center" onClick={() => setView('characters')}><Icon.User size={13} /> Character studio</button>
    </div>
  );
}

function Thumb({ draw, w = 112, h = 63, onClick, active, label }: { draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; w?: number; h?: number; onClick: () => void; active?: boolean; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = ref.current; if (!c) return; const ctx = c.getContext('2d')!; ctx.clearRect(0, 0, w, h); draw(ctx, w, h); }, [draw, w, h]);
  return <button onClick={onClick} className={`rounded-md overflow-hidden border text-[10px] bg-ink-850 ${active ? 'border-accent-500' : 'border-ink-700 hover:border-ink-500'}`}><canvas ref={ref} width={w} height={h} className="block w-full" /><div className="px-1 py-0.5 truncate text-ink-300">{label}</div></button>;
}

function BackgroundsTab() {
  const project = useStore(s => s.current)!;
  const cur = useCurrentSceneIndex();
  const scene = project.scenes[cur];
  const file = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="grid grid-cols-2 gap-1.5">
        {BACKGROUNDS.filter(b => b.id !== 'custom').map(b => <Thumb key={b.id} label={b.label} active={scene?.background === b.id} draw={(ctx, w, h) => drawBackground(ctx, b.id as BackgroundId, { W: w, H: h, floorY: h * 0.8 })} onClick={() => updateScene(cur, s => ({ ...s, background: b.id as BackgroundId }))} />)}
      </div>
      <button className="btn-ghost w-full justify-center mt-2" onClick={() => file.current?.click()}><Icon.Image size={13} /> Custom image…</button>
      <input ref={file} type="file" accept="image/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; const url = await blobToDataUrl(f); updateScene(cur, s => ({ ...s, background: 'custom', customBackgroundUrl: url })); e.target.value = ''; }} />
      <p className="text-[10px] text-ink-500 mt-1">Applies to the current scene.</p>
    </div>
  );
}

function PropsTab() {
  const cur = useCurrentSceneIndex();
  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5">
        {PROP_TYPES.map(t => <Thumb key={t} label={t} w={72} h={60} draw={(ctx, w, h) => { ctx.fillStyle = '#1b1f2b'; ctx.fillRect(0, 0, w, h); drawProp(ctx, t, w / 2, h * 0.9, Math.min(h * 0.8 / Math.max(0.6, PROP_REL_SIZE[t] * 1.6), w * 0.5), {}); }} onClick={() => { const id = uid('prp'); updateScene(cur, s => ({ ...s, props: [...s.props, { id, type: t as PropType, x: 0.5 + (Math.random() - 0.5) * 0.4, y: 0, scale: 1 }] })); select(id); }} />)}
      </div>
      <p className="text-[10px] text-ink-500 mt-2">Click to add to the current scene, then drag it on the canvas. Hand-held props (phone, bag, book, money, banana, cup, ball, wallet, box) follow the character after a “pick up” action.</p>
    </div>
  );
}

function AudioTab() {
  const project = useStore(s => s.current)!;
  const a = project.settings.audio;
  const music = useRef<HTMLInputElement>(null);
  const setA = (patch: Partial<typeof a>) => { commit(p => ({ ...p, settings: { ...p.settings, audio: { ...p.settings.audio, ...patch } } })); refresh(); };
  const lines = project.scenes.flatMap(s => s.dialogue);
  const natural = lines.filter(l => l.audioUrl && l.audioSource === 'voice').length, recorded = lines.filter(l => l.audioUrl && l.audioSource !== 'voice').length;
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { availableVoices().then(v => setInstalled(v.length > 0)); }, []);

  return (
    <div className="space-y-3 text-xs">
      <Section title="Voice">
        <Toggle label="Spoken dialogue" value={a.voiceEnabled} onChange={v => setA({ voiceEnabled: v })} />
        <div className="text-ink-400 mt-1">{natural} of {lines.length} line{lines.length === 1 ? '' : 's'} use a natural voice{recorded ? `, ${recorded} your recording or clip` : ''}{lines.length - natural - recorded > 0 ? `, ${lines.length - natural - recorded} the robotic built-in voice` : ''}.</div>
        {installed === false && <div className="text-ink-400 mt-1">Natural voices are not installed. Run <code className="bg-ink-800 px-1 rounded">npm run voices</code> once (about 200 MB), then restart the app.</div>}
        {installed && lines.length - natural - recorded > 0 && <button className="btn-primary w-full justify-center mt-2" disabled={!!busy} onClick={async () => { try { const n = await voiceLines({}, setBusy); refresh(); toast('success', `Voiced ${n} line${n === 1 ? '' : 's'}`); } catch (e: any) { toast('error', e.message); } finally { setBusy(''); } }}>{busy ? <><Icon.Refresh className="animate-spin" size={13} /> {busy}</> : <><Icon.Sparkle size={13} /> Give remaining lines a natural voice</>}</button>}
        <Slider label="Voice volume" value={a.voiceVolume} onChange={v => setA({ voiceVolume: v })} />
      </Section>
      <Section title="Sound effects">
        <Toggle label="Sound effects" value={a.sfxEnabled} onChange={v => setA({ sfxEnabled: v })} />
        <div className="text-ink-400 mt-1">Footsteps, impacts, doors, boings and comedic hits are synthesized automatically from actions. Add extra cues from the timeline’s Sound FX track.</div>
        <Slider label="SFX volume" value={a.sfxVolume} onChange={v => setA({ sfxVolume: v })} />
      </Section>
      <Section title="Music">
        <Toggle label="Background music" value={a.musicEnabled} onChange={v => setA({ musicEnabled: v })} />
        <select className="input !py-1 mt-1" value={a.musicTrack} onChange={e => { setA({ musicTrack: e.target.value as any }); refresh(); }}>
          <option value="none">None</option>
          <optgroup label="Music library">{LIBRARY.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>
          <optgroup label="Simple">{['upbeat', 'calm', 'comedy', 'tense'].map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</optgroup>
        </select>
        {LIBRARY.find(t => t.id === a.musicTrack) && <div className="text-ink-400 mt-1">{LIBRARY.find(t => t.id === a.musicTrack)!.mood}. Generated on this computer, free to use in your videos.</div>}
        <button className="btn-ghost w-full justify-center mt-1" onClick={() => music.current?.click()}><Icon.Upload size={13} /> {a.importedMusicUrl ? 'Replace imported track' : 'Import music file'}</button>
        {a.importedMusicUrl && <button className="btn-ghost w-full justify-center mt-1 !text-coral" onClick={() => setA({ importedMusicUrl: undefined })}>Remove imported track</button>}
        <input ref={music} type="file" accept="audio/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 60e6) { toast('error', 'Keep imported music under 60 MB.'); return; } setA({ importedMusicUrl: await blobToDataUrl(f), musicEnabled: true }); e.target.value = ''; }} />
        <Slider label="Music volume" value={a.musicVolume} onChange={v => setA({ musicVolume: v })} />
        <div className="grid grid-cols-2 gap-2 mt-1"><label><span className="label">Fade in (s)</span><input type="number" step="0.5" min="0" className="input !py-1" value={a.fadeIn} onChange={e => setA({ fadeIn: Number(e.target.value) })} /></label><label><span className="label">Fade out (s)</span><input type="number" step="0.5" min="0" className="input !py-1" value={a.fadeOut} onChange={e => setA({ fadeOut: Number(e.target.value) })} /></label></div>
      </Section>
      <Section title="Master"><Slider label="Master volume" value={a.masterVolume} onChange={v => setA({ masterVolume: v })} /></Section>
    </div>
  );
}

export async function audioDuration(url: string): Promise<number | undefined> {
  return new Promise(res => { const el = new Audio(); el.preload = 'metadata'; el.onloadedmetadata = () => res(isFinite(el.duration) ? el.duration : undefined); el.onerror = () => res(undefined); el.src = url; });
}

function TextTab() {
  const project = useStore(s => s.current)!;
  const cur = useCurrentSceneIndex();
  const st = project.settings.subtitles;
  const setS = (patch: Partial<typeof st>) => commit(p => ({ ...p, settings: { ...p.settings, subtitles: { ...p.settings.subtitles, ...patch } } }));
  const addText = (kind: 'title' | 'caption' | 'sfx_text' | 'closing', text: string) => { const id = uid('txt'); updateScene(cur, s => ({ ...s, texts: [...s.texts, { id, kind, text, start: 0.2, duration: 2, x: 0.5, y: kind === 'sfx_text' ? 0.3 : 0.18, size: kind === 'title' ? 1.8 : kind === 'sfx_text' ? 1.6 : 1.1, color: kind === 'sfx_text' ? '#ffe36b' : '#ffffff', animation: 'pop' }] })); select(id); };
  return (
    <div className="space-y-3 text-xs">
      <Section title="Titles">
        <label><span className="label">Opening title</span><input className="input !py-1" placeholder="e.g. The Broke Millionaire" value={project.settings.openingTitle ?? ''} onChange={e => commit(p => ({ ...p, settings: { ...p.settings, openingTitle: e.target.value || undefined } }))} /></label>
        <label className="block mt-1"><span className="label">Closing title</span><input className="input !py-1" placeholder="e.g. The End" value={project.settings.closingTitle ?? ''} onChange={e => commit(p => ({ ...p, settings: { ...p.settings, closingTitle: e.target.value || undefined } }))} /></label>
      </Section>
      <Section title="Add to current scene">
        <div className="grid grid-cols-2 gap-1">
          <button className="btn-ghost justify-center" onClick={() => addText('caption', 'Caption')}>Caption</button>
          <button className="btn-ghost justify-center" onClick={() => addText('title', 'Scene title')}>Scene title</button>
          <button className="btn-ghost justify-center" onClick={() => addText('sfx_text', 'BOOM!')}>SFX text</button>
          <button className="btn-ghost justify-center" onClick={() => addText('closing', 'The End')}>Closing card</button>
        </div>
      </Section>
      <Section title="Subtitles">
        <Toggle label="Show subtitles" value={st.enabled} onChange={v => setS({ enabled: v })} />
        <Toggle label="Show speaker names" value={st.showNames} onChange={v => setS({ showNames: v })} />
        <div className="grid grid-cols-2 gap-2 mt-1">
          <label><span className="label">Font</span><select className="input !py-1" value={st.font} onChange={e => setS({ font: e.target.value })}><option value="Inter, system-ui, sans-serif">Inter</option><option value="Impact, 'Arial Black', sans-serif">Impact</option><option value="'Comic Sans MS', 'Comic Neue', cursive">Comic</option><option value="Georgia, serif">Georgia</option><option value="'Courier New', monospace">Courier</option></select></label>
          <label><span className="label">Position</span><select className="input !py-1" value={st.position} onChange={e => setS({ position: e.target.value as any })}><option value="bottom">Bottom (safe area)</option><option value="center">Center</option><option value="top">Top</option></select></label>
          <label><span className="label">Animation</span><select className="input !py-1" value={st.animation} onChange={e => setS({ animation: e.target.value as any })}>{[['none', 'None'], ['pop', 'Pop'], ['fade', 'Fade'], ['typewriter', 'Typewriter'], ['words', 'Word by word (Shorts)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label><span className="label">Size</span><input type="range" min={0.6} max={1.8} step={0.05} value={st.size} onChange={e => setS({ size: Number(e.target.value) })} className="w-full" /></label>
          <label><span className="label">Color</span><input type="color" className="input !p-0.5 h-8" value={st.color} onChange={e => setS({ color: e.target.value })} /></label>
          <label><span className="label">Outline</span><div className="flex gap-1"><input type="color" className="input !p-0.5 h-8 w-10" value={st.outline} onChange={e => setS({ outline: e.target.value })} /><input type="number" min={0} max={12} className="input !py-1" value={st.outlineWidth} onChange={e => setS({ outlineWidth: Number(e.target.value) })} /></div></label>
        </div>
      </Section>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) { return <div className="card p-2.5"><div className="label mb-1.5">{title}</div>{children}</div>; }
export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center justify-between py-0.5 cursor-pointer"><span>{label}</span><button type="button" onClick={() => onChange(!value)} className={`w-8 h-4.5 h-[18px] rounded-full relative transition-colors ${value ? 'bg-accent-500' : 'bg-ink-600'}`}><span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${value ? 'left-4' : 'left-0.5'}`} /></button></label>;
}
export function Slider({ label, value, onChange, min = 0, max = 1, step = 0.05 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return <label className="block mt-1"><div className="flex justify-between"><span className="label">{label}</span><span className="text-ink-400">{typeof value === 'number' ? value.toFixed(2) : value}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full" /></label>;
}
