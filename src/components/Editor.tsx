import { useEffect, useState } from 'react';
import { useStore, setView } from '../store/store';
import { toggle, seek, getPlayback } from '../store/playback';
import Preview from './editor/Preview';
import PlaybackBar from './editor/PlaybackBar';
import Timeline from './editor/Timeline';
import LeftPanel from './editor/LeftPanel';
import Inspector from './editor/Inspector';
import Assistant from './editor/Assistant';
import { Icon } from '../ui/icons';

export default function Editor() {
  const project = useStore(s => s.current)!;
  const [showAssistant, setShowAssistant] = useState(true);
  const [showSafe, setShowSafe] = useState(false);
  const [timelineH, setTimelineH] = useState(230);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      if (e.key === 'ArrowLeft') seek(getPlayback().time - (e.shiftKey ? 1 : 1 / project.settings.fps));
      if (e.key === 'ArrowRight') seek(getPlayback().time + (e.shiftKey ? 1 : 1 / project.settings.fps));
      if (e.key === 'Home') seek(0);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [project.settings.fps]);

  if (!project.scenes.length) return <div className="h-full grid place-items-center text-ink-400"><div className="text-center"><p>This project has no scenes yet.</p><button className="btn-primary mt-3" onClick={() => setView('script')}>Generate from a script</button></div></div>;

  return (
    <div className="h-full flex">
      <LeftPanel />
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 min-h-0 relative">
          <Preview showSafe={showSafe} />
          <div className="absolute top-2 right-2 flex gap-1">
            <button className={`btn-ghost !py-1 !px-2 text-[11px] ${showSafe ? '!text-accent-500' : ''}`} onClick={() => setShowSafe(!showSafe)} title="Toggle safe-area guide">Safe area</button>
            <button className={`btn-ghost !py-1 !px-2 text-[11px] ${showAssistant ? '!text-accent-500' : ''}`} onClick={() => setShowAssistant(!showAssistant)}><Icon.Sparkle size={12} /> Assistant</button>
            <button className="btn-primary !py-1 !px-2 text-[11px]" onClick={() => setView('export')}><Icon.Export size={12} /> Export</button>
          </div>
          <div className="absolute bottom-2 left-2 text-[10px] text-ink-400 bg-ink-900/70 px-2 py-1 rounded">Click to select · drag to move · Space play · ←/→ step frames</div>
        </div>
        <PlaybackBar />
        <div className="h-1.5 cursor-row-resize bg-ink-800 hover:bg-accent-500/50" onPointerDown={e => { const startY = e.clientY, startH = timelineH; const mv = (ev: PointerEvent) => setTimelineH(Math.max(120, Math.min(520, startH + (startY - ev.clientY)))); const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); }} />
        <div style={{ height: timelineH }} className="shrink-0"><Timeline /></div>
      </div>
      <div className="flex shrink-0">
        {showAssistant && <div className="w-[300px] border-l border-ink-800 bg-ink-900 flex flex-col"><Assistant /></div>}
        <Inspector />
      </div>
    </div>
  );
}
