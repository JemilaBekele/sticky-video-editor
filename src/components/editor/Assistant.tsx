import { useState } from 'react';
import { useStore, commit, toast } from '../../store/store';
import { useCurrentSceneIndex } from './Preview';
import { interpretInstruction, applyOps } from '../../parser/assistant';
import { refresh } from '../../store/playback';
import { Icon } from '../../ui/icons';

const SUGGESTIONS = ['Make John run faster', 'Make the reaction funnier', 'Add a two-second pause before the punchline', 'Change the background to a classroom', 'Make the camera zoom in when the character becomes angry', 'Make both characters face each other', 'Add a third stickman who enters the room', 'Make the character look shocked instead of confused'];

export default function Assistant() {
  const project = useStore(s => s.current)!;
  const cur = useCurrentSceneIndex();
  const [text, setText] = useState('');
  const [log, setLog] = useState<{ q: string; a: string; ok: boolean }[]>([]);

  const run = (instruction: string) => {
    const q = instruction.trim(); if (!q) return;
    setText('');
    if (!project.scenes.length) { setLog(l => [{ q, a: 'There are no scenes to edit yet. Generate the script or add a scene first.', ok: false }, ...l]); return; }
    const local = interpretInstruction(q, project, cur);
    if (local && local.ops.length) {
      commit(p => applyOps(p, local.ops, cur)); refresh();
      setLog(l => [{ q, a: local.explanation, ok: true }, ...l]);
    } else {
      const msg = "I couldn't understand that instruction. Try one of the examples, or edit directly in the inspector.";
      setLog(l => [{ q, a: msg, ok: false }, ...l]); toast('error', msg);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="panel-title flex items-center gap-1.5"><Icon.Sparkle size={12} className="text-accent-500" /> Editing assistant</div>
      <div className="p-2 flex gap-1">
        <input className="input !py-1.5" placeholder={`Edit scene ${cur + 1} with a sentence…`} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(text); }} />
        <button className="btn-primary !px-2.5" disabled={!text.trim()} onClick={() => run(text)}><Icon.Send size={14} /></button>
      </div>
      <div className="px-2 pb-2 flex flex-wrap gap-1">
        {SUGGESTIONS.map(s => <button key={s} className="text-[10px] px-1.5 py-0.5 rounded-full border border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-white" onClick={() => run(s.replace('John', project.characters[0]?.name ?? 'John'))}>{s.replace('John', project.characters[0]?.name ?? 'John')}</button>)}
      </div>
      <div className="flex-1 overflow-auto px-2 pb-2 space-y-1.5 text-xs">
        {log.map((l, i) => (
          <div key={i} className={`rounded-lg p-2 border ${l.ok ? 'bg-ink-850 border-ink-700' : 'bg-coral/10 border-coral/30'}`}>
            <div className="text-ink-300 italic">“{l.q}”</div>
            <div className={`mt-0.5 flex gap-1 ${l.ok ? 'text-mint' : 'text-coral'}`}>{l.ok ? <Icon.Check size={12} className="mt-0.5 shrink-0" /> : <Icon.Warn size={12} className="mt-0.5 shrink-0" />}<span>{l.a}</span>{l.ok && <span className="ml-auto text-ink-500">Ctrl+Z to undo</span>}</div>
          </div>
        ))}
        {!log.length && <div className="text-ink-500 p-2">Edits are applied as small targeted changes to the current scene — nothing is regenerated. Every edit can be undone.</div>}
      </div>
    </div>
  );
}
