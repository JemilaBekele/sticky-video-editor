import { useState, useSyncExternalStore } from 'react';
import { newProject, commit, getState, saveNow, toast } from '../store/store';
import { generateProject } from '../store/generate';
import { exportVideo, supportsFast, buildSrt, fmtBytes, fmtTime } from '../export/exporter';
import { LIBRARY } from '../engine/music';
import { type AspectPreset, type AudioSettings, projectDuration } from '../types';
import { Icon } from '../ui/icons';

interface Item { title: string; script: string; status: 'waiting' | 'working' | 'done' | 'error'; detail: string; progress: number; video?: { url: string; name: string; size: number; duration: number }; srt?: string }

// The queue lives outside the page: a batch keeps running (and stays visible) if you look at another page.
let batch: { items: Item[]; running: boolean } = { items: [], running: false };
let batchAbort: AbortController | null = null;
const listeners = new Set<() => void>();
function setBatch(patch: Partial<typeof batch>) { batch = { ...batch, ...patch }; listeners.forEach(l => l()); }
function useBatch() { return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => batch); }
/** True while a batch is generating or rendering (the app keeps other projects closed meanwhile). */
export function useBatchRunning() { return useBatch().running; }
/** Release the video files of a finished batch before starting a new one. */
function releaseItems(items: Item[]) { for (const it of items) { if (it.video) URL.revokeObjectURL(it.video.url); if (it.srt) URL.revokeObjectURL(it.srt); } }

const EXAMPLE = `TITLE: Start Before You Are Ready
SCENE 1: The bedroom
A stickman sits and thinks.
NARRATOR: You are waiting for the perfect moment.
SCENE 2: The road
He walks down the road.
NARRATOR: It will never come. Start today.
---
TITLE: Discipline Beats Motivation
SCENE 1: 5 AM
The alarm rings. A stickman wakes up.
NARRATOR: Motivation gets you started.
SCENE 2: The gym
He lifts weights.
NARRATOR: Discipline keeps you going.
---
TITLE: Fall Seven Times
SCENE 1: The street
A stickman runs and falls.
NARRATOR: Fall seven times.
SCENE 2: The summit
He gets up and celebrates.
NARRATOR: Stand up eight.`;

/** Turn several scripts into finished videos in one run — for channels that post every day. */
export default function BatchView() {
  const [text, setText] = useState('');
  const [aspect, setAspect] = useState<AspectPreset>('portrait');
  const [music, setMusic] = useState<AudioSettings['musicTrack']>('inspiring');
  const [words, setWords] = useState(true);
  const { items, running } = useBatch();

  const scripts = text.split(/^\s*-{3,}\s*$/m).map(s => s.trim()).filter(Boolean);
  const titleOf = (s: string) => (s.match(/^\s*TITLE\s*[:\-]\s*(.+)$/im)?.[1] ?? s.split('\n')[0]).replace(/^["']|["']$/g, '').trim().slice(0, 60) || 'Untitled';
  const update = (i: number, patch: Partial<Item>) => setBatch({ items: batch.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });

  const run = async () => {
    if (!scripts.length) { toast('error', 'Paste at least one script. Separate scripts with a line containing ---'); return; }
    const queue: Item[] = scripts.map(s => ({ title: titleOf(s), script: s, status: 'waiting', detail: 'Waiting', progress: 0 }));
    releaseItems(batch.items);
    setBatch({ items: queue, running: true });
    const abort = batchAbort = new AbortController();
    let done = 0;
    for (const [i, it] of queue.entries()) {
      if (abort.signal.aborted) { update(i, { status: 'error', detail: 'Cancelled' }); continue; }
      update(i, { status: 'working', detail: 'Writing scenes…', progress: 0.02 });
      try {
        newProject(it.title, 'batch');
        commit(p => ({ ...p, settings: { ...p.settings, aspect, subtitles: { ...p.settings.subtitles, animation: words ? 'words' : 'pop', position: aspect === 'portrait' ? 'top' : 'bottom', showNames: !words }, audio: { ...p.settings.audio, musicTrack: music, musicEnabled: music !== 'none', musicVolume: 0.3 } } }), { undoable: false });
        const g = await generateProject(it.script, 'script', t => update(i, { detail: t, progress: 0.08 }));
        const project = getState().current!;   // taken before any wait, so it is this item's project
        await saveNow(true);
        const r = await exportVideo(project, {
          aspect, fps: 30, format: 'mp4', mode: supportsFast() ? 'fast' : 'realtime', includeAudio: true, signal: abort.signal,
          onProgress: pr => update(i, { detail: pr.phase, progress: 0.1 + 0.9 * pr.progress }),
        });
        const base = it.title.replace(/[^\w\- ]+/g, '').trim() || 'video';
        update(i, { status: 'done', progress: 1, detail: g.warnings.length ? `Done · ${g.warnings.length} sentence${g.warnings.length > 1 ? 's' : ''} not understood` : 'Done', video: { url: r.url, name: `${base}.mp4`, size: r.size, duration: projectDuration(project) }, srt: URL.createObjectURL(new Blob([buildSrt(project)], { type: 'application/x-subrip' })) });
        done++;
      } catch (e: any) {
        update(i, { status: 'error', detail: e?.message ?? String(e) });
      }
    }
    setBatch({ running: false });
    toast(done === queue.length ? 'success' : 'info', `Batch finished: ${done} of ${queue.length} videos rendered. Each one is also saved as a project on the dashboard.`);
  };

  const downloadAll = async () => {
    for (const it of items) {
      if (!it.video) continue;
      const a = document.createElement('a'); a.href = it.video.url; a.download = it.video.name; a.click();
      await new Promise(r => setTimeout(r, 400));   // browsers drop rapid back-to-back downloads
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        <div>
          <p className="text-sm text-ink-400">Paste several scripts and render them all in one go. Separate scripts with a line containing <code className="bg-ink-800 px-1 rounded">---</code>. Each becomes its own project and MP4.</p>
          <textarea className="input mt-3 h-[46vh] min-h-[280px] font-mono text-[13px] leading-relaxed resize-y" placeholder={EXAMPLE} value={text} onChange={e => setText(e.target.value)} spellCheck={false} disabled={running} />
          <div className="flex flex-wrap items-center gap-3 mt-3">
            {!running
              ? <button className="btn-primary !px-5 !py-2.5 text-base shadow-glow" onClick={run} disabled={!scripts.length}><Icon.Film size={18} /> Create {scripts.length || ''} video{scripts.length === 1 ? '' : 's'}</button>
              : <button className="btn-danger !px-5 !py-2.5" onClick={() => batchAbort?.abort()}><Icon.Stop size={16} /> Stop after current</button>}
            <button className="btn-ghost" onClick={() => setText(EXAMPLE)} disabled={running}>Use example</button>
            <span className="text-xs text-ink-400 ml-auto">{scripts.length} script{scripts.length === 1 ? '' : 's'}</span>
          </div>

          {items.length > 0 && (
            <div className="mt-6 space-y-2">
              <div className="flex items-center"><h3 className="font-semibold">Queue</h3>{items.some(i => i.video) && <button className="btn-ghost ml-auto text-xs" onClick={downloadAll}><Icon.Download size={13} /> Download all videos</button>}</div>
              {items.map((it, i) => (
                <div key={i} className="card p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${it.status === 'done' ? 'bg-mint' : it.status === 'error' ? 'bg-coral' : it.status === 'working' ? 'bg-accent-500 animate-pulse' : 'bg-ink-500'}`} />
                    <span className="font-medium truncate">{i + 1}. {it.title}</span>
                    <span className={`ml-auto text-xs truncate max-w-[50%] ${it.status === 'error' ? 'text-coral' : 'text-ink-400'}`}>{it.detail}</span>
                  </div>
                  {it.status === 'working' && <div className="h-1.5 bg-ink-800 rounded-full mt-2 overflow-hidden"><div className="h-full bg-accent-500 transition-all" style={{ width: `${Math.round(it.progress * 100)}%` }} /></div>}
                  {it.video && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-ink-300">
                      <span>{fmtTime(it.video.duration)} · {fmtBytes(it.video.size)}</span>
                      <a className="btn-primary !py-1 ml-auto" href={it.video.url} download={it.video.name}><Icon.Download size={12} /> MP4</a>
                      {it.srt && <a className="btn-ghost !py-1" href={it.srt} download={it.video.name.replace(/\.mp4$/, '.srt')}>Captions</a>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="card p-4 space-y-3 text-sm">
            <div className="label">Settings for every video</div>
            <label className="block"><span className="label">Format</span>
              <select className="input mt-1" value={aspect} onChange={e => setAspect(e.target.value as AspectPreset)} disabled={running}>
                <option value="portrait">Shorts / TikTok / Reels · 1080×1920</option><option value="landscape">YouTube · 1920×1080</option><option value="square">Square · 1080×1080</option>
              </select></label>
            <label className="block"><span className="label">Music</span>
              <select className="input mt-1" value={music} onChange={e => setMusic(e.target.value as AudioSettings['musicTrack'])} disabled={running}>
                <option value="none">None</option>{LIBRARY.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select></label>
            <label className="flex items-center justify-between"><span>Word-by-word captions</span><input type="checkbox" checked={words} onChange={e => setWords(e.target.checked)} disabled={running} /></label>
          </div>
          <div className="card p-4 text-xs text-ink-300 space-y-1">
            <div className="label">How it works</div>
            <p>Each script is turned into scenes, voiced, and rendered to MP4 one after another{supportsFast() ? ' with the fast hardware encoder' : ' (real time — use Chrome or Edge for fast rendering)'}.</p>
            <p>Every video is also saved as a normal project, so you can open it from the dashboard and fine-tune it later.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
