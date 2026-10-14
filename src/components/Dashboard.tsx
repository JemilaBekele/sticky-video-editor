import { useRef, useState } from 'react';
import { useStore, newProject, openProject, duplicateProject, deleteProject, renameProject, setView, loadProjectObject, toast, commit } from '../store/store';
import { generateProject, reportGeneration, SAMPLE_SCRIPT, SAMPLE_MOTIVATION } from '../store/generate';
import { Icon } from '../ui/icons';
import { fmtTime } from '../export/exporter';
import { useServerStatus } from './hooks';

export default function Dashboard() {
  const projects = useStore(s => s.projects);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const status = useServerStatus();

  const createSample = async () => {
    setBusy(true);
    try {
      const p = newProject('The Broke Millionaire');
      void p;
      const r = await generateProject(SAMPLE_SCRIPT, 'script');
      reportGeneration(r);
      setView('storyboard');
    } catch (e: any) { toast('error', e.message); } finally { setBusy(false); }
  };

  /** Vertical short with narration, word-by-word captions and inspiring music — the usual motivation-channel format. */
  const createShort = async () => {
    setBusy(true);
    try {
      newProject('Never Give Up');
      commit(p => ({ ...p, settings: { ...p.settings, aspect: 'portrait', subtitles: { ...p.settings.subtitles, animation: 'words', position: 'top', showNames: false }, audio: { ...p.settings.audio, musicTrack: 'inspiring', musicVolume: 0.3 } } }), { undoable: false });
      reportGeneration(await generateProject(SAMPLE_MOTIVATION, 'script', t => toast('info', t)));
      setView('storyboard');
    } catch (e: any) { toast('error', e.message); } finally { setBusy(false); }
  };

  const importJSON = async (f: File) => {
    try { const p = JSON.parse(await f.text()); if (!p?.scenes || !p?.id) throw new Error('Not a Sticky Motion project file'); p.id = `prj_${Math.random().toString(36).slice(2, 10)}`; loadProjectObject(p, 'editor'); toast('success', `Imported “${p.name}”`); }
    catch (e: any) { toast('error', `Import failed: ${e.message}`); }
  };

  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-6xl mx-auto">
        <section className="card p-8 bg-gradient-to-br from-ink-850 to-ink-900 relative overflow-hidden">
          <div className="absolute -right-10 -top-10 w-64 h-64 rounded-full bg-accent-500/10 blur-3xl" />
          <h1 className="text-3xl font-bold tracking-tight">Turn a script into a stickman video.</h1>
          <p className="text-ink-300 mt-2 max-w-2xl">Paste a script or describe a scene. Sticky Motion AI finds the characters, splits the story into scenes, animates every action, adds dialogue, camera moves and subtitles, and renders a real video file.</p>
          <div className="flex flex-wrap gap-3 mt-6">
            <button className="btn-primary !px-5 !py-2.5 text-base shadow-glow" onClick={() => newProject()}><Icon.Plus size={18} /> Create New Animation</button>
            <button className="btn-ghost !px-4 !py-2.5" disabled={busy} onClick={createShort} title="Vertical 9:16 video with narration and word-by-word captions"><Icon.Film size={16} /> Motivational Short template</button>
            <button className="btn-ghost !px-4 !py-2.5" disabled={busy} onClick={createSample}><Icon.Sparkle size={16} /> {busy ? 'Generating sample…' : 'Load sample project'}</button>
            <button className="btn-ghost !px-4 !py-2.5" onClick={() => fileRef.current?.click()}><Icon.Folder size={16} /> Open project file</button>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importJSON(f); e.target.value = ''; }} />
          </div>
          <div className="flex flex-wrap gap-4 mt-6 text-xs text-ink-400">
            <Status ok label="Works offline — no API keys needed" />
            <Status ok label="Script parser: built in" />
            <Status ok label="Voices: built in" />
            <Status ok={status.ffmpeg} label={status.ffmpeg ? 'MP4: system ffmpeg' : 'MP4: in-browser ffmpeg.wasm'} />
          </div>
        </section>

        <section className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Recent projects</h2>
            <button className="btn-ghost" onClick={() => newProject()}><Icon.Plus size={14} /> New project</button>
          </div>
          {projects.length === 0 ? (
            <div className="card p-10 text-center text-ink-400">No projects yet. Create one or load the sample.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {projects.map(p => <ProjectCard key={p.id} p={p} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) { return <span className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-mint' : 'bg-ink-500'}`} />{label}</span>; }

function ProjectCard({ p }: { p: { id: string; name: string; updatedAt: number; thumbnail?: string; duration: number; scenes: number } }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  return (
    <div className="card overflow-hidden group">
      <button className="block w-full aspect-video bg-ink-900 relative" onClick={() => openProject(p.id)}>
        {p.thumbnail ? <img src={p.thumbnail} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full grid place-items-center text-ink-500"><Icon.Film size={28} /></div>}
        <span className="absolute bottom-2 right-2 text-[10px] bg-black/60 px-1.5 py-0.5 rounded">{fmtTime(p.duration)} · {p.scenes} sc</span>
      </button>
      <div className="p-3">
        {editing ? (
          <input autoFocus className="input !py-1" value={name} onChange={e => setName(e.target.value)} onBlur={() => { setEditing(false); if (name.trim()) renameProject(p.id, name.trim()); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        ) : (
          <div className="font-medium text-sm truncate cursor-text" onDoubleClick={() => setEditing(true)} title="Double-click to rename">{p.name}</div>
        )}
        <div className="text-xs text-ink-400 mt-0.5">Edited {new Date(p.updatedAt).toLocaleString()}</div>
        <div className="flex gap-1 mt-3">
          <button className="btn-ghost !px-2 !py-1 text-xs flex-1" onClick={() => openProject(p.id)}>Open</button>
          <button className="btn-ghost !px-2 !py-1" title="Duplicate" onClick={() => duplicateProject(p.id)}><Icon.Copy size={13} /></button>
          <button className="btn-ghost !px-2 !py-1" title="Rename" onClick={() => setEditing(true)}><Icon.Edit size={13} /></button>
          <button className="btn-danger !px-2 !py-1" title="Delete" onClick={() => { if (confirm(`Delete “${p.name}”? This cannot be undone.`)) deleteProject(p.id); }}><Icon.Trash size={13} /></button>
        </div>
      </div>
    </div>
  );
}
