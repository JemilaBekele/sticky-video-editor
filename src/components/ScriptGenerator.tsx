import { useState } from 'react';
import { useStore, commit, setView, toast } from '../store/store';
import { generateProject, reportGeneration, SAMPLE_SCRIPT, SAMPLE_PROMPT, SAMPLE_IDEA } from '../store/generate';
import { Icon } from '../ui/icons';
import type { Project } from '../types';

const MODES: { id: Project['inputMode']; label: string; hint: string; sample: string }[] = [
  { id: 'prompt', label: 'Text Prompt', hint: 'Describe the animation in a few sentences.', sample: SAMPLE_PROMPT },
  { id: 'script', label: 'Full Script', hint: 'Paste a script with scenes, dialogue (NAME: "…"), narration and actions.', sample: SAMPLE_SCRIPT },
  { id: 'idea', label: 'Story Idea', hint: 'Give a rough story; the app organizes it into scenes.', sample: SAMPLE_IDEA },
];

export default function ScriptGenerator() {
  const project = useStore(s => s.current)!;
  const [mode, setMode] = useState<Project['inputMode']>(project.inputMode);
  const [text, setText] = useState(project.script);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const hasScenes = project.scenes.length > 0;

  const generate = async () => {
    if (!text.trim()) { toast('error', 'Write or paste something first.'); return; }
    if (hasScenes && !confirm('This replaces the current scenes (undo is available). Continue?')) return;
    setBusy(true);
    setProgress('Analyzing…');
    try { const r = await generateProject(text, mode, setProgress); reportGeneration(r); setView('storyboard'); }
    catch (e: any) { toast('error', e.message ?? String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <input className="input !text-lg !font-semibold !bg-transparent !border-transparent hover:!border-ink-700 !px-2" value={project.name} onChange={e => commit(p => ({ ...p, name: e.target.value }), { undoable: false })} />
          </div>
          <div className="flex gap-1 p-1 bg-ink-900 rounded-xl border border-ink-800 w-fit">
            {MODES.map(m => <button key={m.id} onClick={() => setMode(m.id)} className={`px-3 py-1.5 rounded-lg text-sm ${mode === m.id ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-white'}`}>{m.label}</button>)}
          </div>
          <p className="text-sm text-ink-400 mt-2">{MODES.find(m => m.id === mode)!.hint}</p>
          <textarea className="input mt-3 h-[52vh] min-h-[320px] font-mono text-[13px] leading-relaxed resize-y" placeholder={MODES.find(m => m.id === mode)!.sample} value={text} onChange={e => setText(e.target.value)} spellCheck={false} />
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button className="btn-primary !px-5 !py-2.5 text-base shadow-glow" disabled={busy} onClick={generate}>
              {busy ? <><Icon.Refresh className="animate-spin" size={18} /> {progress || 'Analyzing…'}</> : <><Icon.Sparkle size={18} /> Generate Animation</>}
            </button>
            <button className="btn-ghost" onClick={() => setText(MODES.find(m => m.id === mode)!.sample)}>Use example</button>
            {hasScenes && <button className="btn-ghost" onClick={() => setView('storyboard')}>Go to storyboard <Icon.Right size={14} /></button>}
            <span className="text-xs text-ink-400 ml-auto">{text.trim().split(/\s+/).filter(Boolean).length} words</span>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="card p-4">
            <div className="label mb-2">How to write it</div>
            <div className="text-sm flex items-start gap-2"><Icon.Wand className="text-sky mt-0.5 shrink-0" size={16} /><div><div className="font-medium">Built-in script parser</div><div className="text-ink-400 text-xs mt-0.5">Works offline. Use SCENE headers, NAME: dialogue, and short action sentences with verbs like walk, run, point, laugh, slip, fall… Sentences it cannot understand are listed after generating.</div></div></div>
          </div>
          <div className="card p-4 text-xs text-ink-300 space-y-2">
            <div className="label">What gets detected</div>
            <ul className="list-disc pl-4 space-y-1">
              <li><b className="text-ink-200">Characters</b> from speakers and names (“John”, “the shopkeeper”, “the second stickman”).</li>
              <li><b className="text-ink-200">Actions</b>: 35 movements incl. walk, run, point, laugh, slip, fall, sneak, freeze, shake hands…</li>
              <li><b className="text-ink-200">Emotions</b>, <b className="text-ink-200">accessories</b> (“wearing sunglasses” stays on in later scenes), <b className="text-ink-200">props</b> (phone, banana peel, money…).</li>
              <li><b className="text-ink-200">Backgrounds</b> from context (street, shop, classroom…), <b className="text-ink-200">camera</b> moves from story beats, <b className="text-ink-200">SFX</b> from impacts.</li>
            </ul>
          </div>
          {project.analysis && (
            <div className="card p-4 text-xs">
              <div className="label mb-1">Last generation</div>
              <div>{new Date(project.analysis.at).toLocaleTimeString()} · {project.analysis.warnings.length ? `${project.analysis.warnings.length} sentence${project.analysis.warnings.length > 1 ? 's' : ''} not understood` : 'everything understood'}</div>
              {project.analysis.warnings.map((w, i) => <div key={i} className="text-accent-400 mt-1 flex gap-1"><Icon.Warn size={12} className="shrink-0 mt-0.5" />{w}</div>)}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
