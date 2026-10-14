import { useStore } from '../../store/store';
import { usePlayback, play, pause, stop, seek, setSpeed, setLoop, setMuted } from '../../store/playback';
import { useTimeThrottled } from './Preview';
import { sceneStartTimes, projectDuration, locateScene } from '../../types';
import { Icon } from '../../ui/icons';
import { fmtTime } from '../../export/exporter';

export default function PlaybackBar() {
  const project = useStore(s => s.current)!;
  const playing = usePlayback(p => p.playing);
  const speed = usePlayback(p => p.speed);
  const loop = usePlayback(p => p.loop);
  const muted = usePlayback(p => p.muted);
  const t = useTimeThrottled();
  const total = projectDuration(project);
  const starts = sceneStartTimes(project);
  const { index } = locateScene(project, t);
  const prevScene = () => { const cur = starts[index]; seek(t - cur > 0.3 ? cur : starts[Math.max(0, index - 1)]); };
  const nextScene = () => seek(index + 1 < starts.length ? starts[index + 1] : total);

  return (
    <div className="flex items-center gap-2 px-3 h-11 border-t border-ink-800 bg-ink-900">
      <button className="btn-ghost !p-1.5" onClick={prevScene} title="Previous scene"><Icon.Prev size={14} /></button>
      <button className="btn-primary !p-1.5 !rounded-full w-8 h-8 justify-center" onClick={() => (playing ? pause() : play())} title="Play / Pause (Space)">{playing ? <Icon.Pause size={14} /> : <Icon.Play size={14} />}</button>
      <button className="btn-ghost !p-1.5" onClick={stop} title="Stop"><Icon.Stop size={14} /></button>
      <button className="btn-ghost !p-1.5" onClick={nextScene} title="Next scene"><Icon.Next size={14} /></button>
      <span className="font-mono text-xs text-ink-300 w-32 text-center whitespace-nowrap">{fmtTime(t)} / {fmtTime(total)}</span>
      <input type="range" min={0} max={total} step={0.01} value={Math.min(t, total)} onChange={e => seek(Number(e.target.value))} className="flex-1" />
      <span className="text-xs text-ink-400 w-20 truncate">Scene {index + 1}/{project.scenes.length}</span>
      <select className="input !w-auto !py-1 !text-xs" value={speed} onChange={e => setSpeed(Number(e.target.value))} title="Playback speed">
        {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map(s => <option key={s} value={s}>{s}×</option>)}
      </select>
      <button className={`btn-ghost !p-1.5 ${loop ? '!text-accent-500' : ''}`} onClick={() => setLoop(!loop)} title="Loop"><Icon.Loop size={14} /></button>
      <button className={`btn-ghost !p-1.5 ${muted ? '!text-coral' : ''}`} onClick={() => setMuted(!muted)} title={muted ? 'Unmute' : 'Mute preview'}>{muted ? <Icon.Mute size={14} /> : <Icon.Audio size={14} />}</button>
    </div>
  );
}
