import { useEffect, useRef, useState } from 'react';
import { useStore, commit, toast, exportProjectJSON } from '../store/store';
import { type AspectPreset, ASPECT_SIZES, projectDuration } from '../types';
import { exportVideo, supportsRealtime, supportsFast, buildSrt, renderStill, fmtBytes, fmtTime, type ExportResult, type ExportOptions } from '../export/exporter';
import Preview from './editor/Preview';
import PlaybackBar from './editor/PlaybackBar';
import { pause, getPlayback } from '../store/playback';
import { Icon } from '../ui/icons';
import { useServerStatus } from './hooks';

const PRESETS: { id: string; label: string; aspect: AspectPreset; fps: 24 | 30 | 60; hint: string }[] = [
  { id: 'shorts', label: 'YouTube Shorts', aspect: 'portrait', fps: 30, hint: '1080×1920 · 30 fps' },
  { id: 'tiktok', label: 'TikTok', aspect: 'portrait', fps: 30, hint: '1080×1920 · 30 fps' },
  { id: 'reels', label: 'Instagram Reels', aspect: 'portrait', fps: 30, hint: '1080×1920 · 30 fps' },
  { id: 'youtube', label: 'YouTube video', aspect: 'landscape', fps: 30, hint: '1920×1080 · 30 fps' },
  { id: 'square', label: 'Square post', aspect: 'square', fps: 30, hint: '1080×1080 · 30 fps' },
];

export default function ExportView() {
  const project = useStore(s => s.current)!;
  const status = useServerStatus();
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [mode, setMode] = useState<'fast' | 'realtime' | 'frames'>(supportsFast() ? 'fast' : 'realtime');
  const [scale, setScale] = useState(1);
  const [audio, setAudio] = useState(true);
  const [progress, setProgress] = useState<{ phase: string; progress: number; detail?: string } | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const duration = projectDuration(project);
  const size = ASPECT_SIZES[project.settings.aspect];
  const W = Math.round(size.w * scale), H = Math.round(size.h * scale);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  // leaving the page stops a render in progress, and a video finished after leaving is released
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; abort.current?.abort(); }, []);

  const setAspect = (aspect: AspectPreset, fps?: 24 | 30 | 60) => commit(p => ({ ...p, settings: { ...p.settings, aspect, fps: fps ?? p.settings.fps } }));

  const run = async () => {
    if (!project.scenes.length) { toast('error', 'Nothing to render — the project has no scenes.'); return; }
    pause(); setError(null); setResult(null);
    abort.current = new AbortController();
    const opts: ExportOptions = { aspect: project.settings.aspect, fps: project.settings.fps, format, mode, scale, includeAudio: audio, signal: abort.current.signal, onProgress: p => setProgress(p) };
    setProgress({ phase: 'Preparing', progress: 0 });
    try {
      const r = await exportVideo(project, opts);
      if (!mounted.current) { URL.revokeObjectURL(r.url); return; }
      setResult(r); setProgress(null);
      toast('success', `Rendered ${fmtTime(r.duration)} of video (${fmtBytes(r.size)})`);
    } catch (e: any) {
      setProgress(null);
      const msg = e?.message ?? String(e);
      setError(msg); toast('error', `Rendering failed: ${msg}`);
    }
  };

  const base = project.name.replace(/[^\w\- ]+/g, '').trim() || 'animation';
  const download = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  const saveSrt = () => { if (!project.scenes.some(s => s.dialogue.length)) { toast('error', 'There is no dialogue to caption.'); return; } download(new Blob([buildSrt(project)], { type: 'application/x-subrip' }), `${base}.srt`); };
  const saveThumb = async (yt: boolean) => { const t = Math.min(getPlayback().time, Math.max(0, duration - 0.05)); download(await renderStill(project, t, yt ? 1280 : W, yt ? 720 : H), `${base}-thumbnail.png`); };
  const fileName = `${base}.${result?.mime.includes('mp4') ? 'mp4' : 'webm'}`;

  return (
    <div className="h-full flex">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 min-h-0">
          {result ? (
            <div className="h-full bg-black p-4 overflow-hidden"><video key={result.url} src={result.url} controls autoPlay className="w-full h-full object-contain rounded-md" /></div>
          ) : <Preview interactive={false} showSafe={project.settings.aspect === 'portrait'} />}
        </div>
        {!result && <PlaybackBar />}
        {result && <div className="h-11 border-t border-ink-800 bg-ink-900 flex items-center px-3 gap-3 text-xs text-ink-300"><Icon.Check size={14} className="text-mint" /> Rendered video preview. <button className="btn-ghost !py-1" onClick={() => setResult(null)}>Back to live preview</button></div>}
      </div>

      <div className="w-[360px] shrink-0 border-l border-ink-800 bg-ink-900 overflow-auto p-4 space-y-4 text-sm">
        <div>
          <div className="label mb-2">Platform preset</div>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map(p => <button key={p.id} onClick={() => setAspect(p.aspect, p.fps)} className={`text-left px-2.5 py-2 rounded-lg border text-xs ${project.settings.aspect === p.aspect ? 'border-accent-500/70 bg-ink-800' : 'border-ink-700 hover:bg-ink-850'}`}><div className="font-medium">{p.label}</div><div className="text-ink-400">{p.hint}</div></button>)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label><span className="label">Orientation</span><select className="input mt-1" value={project.settings.aspect} onChange={e => setAspect(e.target.value as AspectPreset)}>{Object.entries(ASPECT_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label><span className="label">Frame rate</span><select className="input mt-1" value={project.settings.fps} onChange={e => commit(p => ({ ...p, settings: { ...p.settings, fps: Number(e.target.value) as any } }))}><option value={24}>24 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></select></label>
          <label><span className="label">Resolution</span><select className="input mt-1" value={scale} onChange={e => setScale(Number(e.target.value))}><option value={1}>Full · {size.w}×{size.h}</option><option value={0.75}>75% · {Math.round(size.w * 0.75)}×{Math.round(size.h * 0.75)}</option><option value={0.5}>50% · {size.w / 2}×{size.h / 2}</option></select></label>
          <label><span className="label">Format</span><select className="input mt-1" value={format} onChange={e => setFormat(e.target.value as any)}><option value="mp4">MP4 (H.264)</option><option value="webm" disabled={mode === 'fast'}>WebM (VP9/VP8){mode === 'fast' ? ' — use real-time mode' : ''}</option></select></label>
        </div>
        <div>
          <div className="label mb-1">Render mode</div>
          {supportsFast() && <label className={`flex gap-2 p-2 rounded-lg border cursor-pointer mb-1.5 ${mode === 'fast' ? 'border-accent-500/70 bg-ink-800' : 'border-ink-700'}`}><input type="radio" className="mt-1" checked={mode === 'fast'} onChange={() => { setMode('fast'); setFormat('mp4'); }} /><div><div className="font-medium text-xs">Fast <span className="text-mint">(recommended)</span></div><div className="text-[11px] text-ink-400">Renders every frame and encodes H.264 + AAC MP4 with the browser’s hardware encoder. Usually several times faster than real time, and you can switch tabs while it works.</div></div></label>}
          <label className={`flex gap-2 p-2 rounded-lg border cursor-pointer ${mode === 'realtime' ? 'border-accent-500/70 bg-ink-800' : 'border-ink-700'}`}><input type="radio" className="mt-1" checked={mode === 'realtime'} onChange={() => setMode('realtime')} disabled={!supportsRealtime()} /><div><div className="font-medium text-xs">Real-time capture <span className="text-ink-400">(fast, ≈ video length)</span></div><div className="text-[11px] text-ink-400">Plays the animation into a recorder with mixed audio. {format === 'mp4' ? (status.ffmpeg ? 'Converted to H.264 by the system ffmpeg.' : 'Converted to H.264 in the browser with ffmpeg.wasm.') : 'Produces WebM directly.'} Keep this tab visible while recording.</div></div></label>
          <label className={`flex gap-2 p-2 rounded-lg border cursor-pointer mt-1.5 ${mode === 'frames' ? 'border-accent-500/70 bg-ink-800' : 'border-ink-700'}`}><input type="radio" className="mt-1" checked={mode === 'frames'} onChange={() => { setMode('frames'); setFormat('mp4'); }} /><div><div className="font-medium text-xs">Frame-by-frame <span className="text-ink-400">(precise, slower)</span></div><div className="text-[11px] text-ink-400">Renders every frame at exact timestamps and encodes H.264 + AAC with ffmpeg.wasm in the browser. Independent of machine speed; best for 60 fps or long videos.</div></div></label>
        </div>
        <label className="flex items-center justify-between"><span>Include audio (voices, SFX, music)</span><input type="checkbox" checked={audio} onChange={e => setAudio(e.target.checked)} /></label>
        <label className="flex items-center justify-between"><span>Burn in subtitles</span><input type="checkbox" checked={project.settings.subtitles.enabled} onChange={e => commit(p => ({ ...p, settings: { ...p.settings, subtitles: { ...p.settings.subtitles, enabled: e.target.checked } } }))} /></label>

        <div className="card p-3 text-xs text-ink-300">
          <div className="flex justify-between"><span>Output</span><span className="font-mono">{W}×{H} · {project.settings.fps} fps · {format.toUpperCase()}</span></div>
          <div className="flex justify-between mt-1"><span>Duration</span><span className="font-mono">{fmtTime(duration)} · {Math.ceil(duration * project.settings.fps)} frames</span></div>
          <div className="flex justify-between mt-1"><span>Scenes</span><span className="font-mono">{project.scenes.length}</span></div>
        </div>

        {!progress && (
          <button className="btn-primary w-full justify-center !py-3 text-base shadow-glow" onClick={run}><Icon.Film size={18} /> Render video</button>
        )}
        {progress && (
          <div className="card p-3">
            <div className="flex justify-between text-xs"><span className="font-medium">{progress.phase}</span><span className="font-mono text-ink-400">{progress.detail ?? `${Math.round(progress.progress * 100)}%`}</span></div>
            <div className="h-2 bg-ink-800 rounded-full mt-2 overflow-hidden"><div className="h-full bg-accent-500 transition-all" style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div>
            <button className="btn-danger w-full justify-center mt-3" onClick={() => abort.current?.abort()}>Cancel</button>
          </div>
        )}
        {error && <div className="rounded-lg border border-coral/40 bg-coral/10 p-3 text-xs text-coral flex gap-2"><Icon.Warn size={14} className="shrink-0 mt-0.5" /><div><div className="font-semibold">Rendering failed</div><div className="mt-0.5">{error}</div><div className="text-ink-300 mt-1">Your project is unchanged and still saved. Try a lower resolution, the other render mode, or a Chromium-based browser.</div></div></div>}
        {result && (
          <div className="card p-3 space-y-2">
            <div className="font-semibold text-mint flex items-center gap-1.5"><Icon.Check size={14} /> Video ready</div>
            <div className="grid grid-cols-2 gap-y-1 text-xs text-ink-300"><span>Duration</span><span className="font-mono text-right">{fmtTime(result.duration)}</span><span>Resolution</span><span className="font-mono text-right">{result.width}×{result.height}</span><span>File size</span><span className="font-mono text-right">{fmtBytes(result.size)}</span><span>Type</span><span className="font-mono text-right">{result.mime}</span></div>
            <a className="btn-primary w-full justify-center" href={result.url} download={fileName}><Icon.Download size={16} /> Download {fileName}</a>
            {result.warnings.map((w, i) => <div key={i} className="text-[11px] text-accent-400 flex gap-1"><Icon.Warn size={12} className="shrink-0 mt-0.5" />{w}</div>)}
          </div>
        )}
        <div className="pt-2 border-t border-ink-800 flex gap-2">
          <button className="btn-ghost flex-1 justify-center text-xs" onClick={() => exportProjectJSON(project)}><Icon.Download size={13} /> Save project file (.json)</button>
        </div>
        <div>
          <div className="label mb-1">For uploading</div>
          <div className="grid grid-cols-2 gap-1.5">
            <button className="btn-ghost justify-center text-xs" onClick={saveSrt} title="Caption file for YouTube, TikTok and video editors"><Icon.Download size={13} /> Captions (.srt)</button>
            <button className="btn-ghost justify-center text-xs" onClick={() => saveThumb(true)} title="1280×720 still of the frame at the playhead"><Icon.Download size={13} /> YouTube thumbnail</button>
          </div>
          <p className="text-[11px] text-ink-500 mt-1">The thumbnail uses the frame at the playhead — scrub the preview to choose it.</p>
        </div>
      </div>
    </div>
  );
}
