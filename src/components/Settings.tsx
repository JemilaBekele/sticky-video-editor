import { useStore, updateSettings, toast } from '../store/store';
import { useServerStatus } from './hooks';
import { getServerStatus } from '../store/server';
import { useEffect, useState } from 'react';
import { Icon } from '../ui/icons';

export default function SettingsView() {
  const settings = useStore(s => s.settings);
  const live = useServerStatus();
  const [checked, setStatus] = useState<typeof live | null>(null);
  const status = checked ?? live;   // the live status until the user re-checks
  const recheck = async () => { const s = await getServerStatus(true); setStatus(s); toast(s.ok ? 'success' : 'error', s.ok ? 'Server reachable' : 'Server not reachable'); };
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  useEffect(() => { navigator.storage?.estimate?.().then(e => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => {}); }, []);

  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <section className="card p-5">
          <h3 className="font-semibold mb-3">Generation</h3>
          <Row label="Default orientation for new projects"><select className="input !w-auto" value={settings.defaultAspect} onChange={e => updateSettings({ defaultAspect: e.target.value as any })}><option value="landscape">Landscape 16:9</option><option value="portrait">Portrait 9:16</option><option value="square">Square 1:1</option></select></Row>
          <Row label="Default frame rate"><select className="input !w-auto" value={settings.defaultFps} onChange={e => updateSettings({ defaultFps: Number(e.target.value) as any })}><option value={24}>24</option><option value={30}>30</option><option value={60}>60</option></select></Row>
          <Row label="Preview quality" hint="High renders the preview at device pixel ratio; Low is faster on weak machines."><select className="input !w-auto" value={settings.previewQuality} onChange={e => updateSettings({ previewQuality: e.target.value as any })}><option value="high">High</option><option value="low">Low</option></select></Row>
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">Video encoding</h3><button className="btn-ghost" onClick={recheck}><Icon.Refresh size={13} /> Re-check</button></div>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <Dot ok={status.ok} /><div>Local server {status.ok ? 'connected' : 'offline — MP4 is encoded in the browser'}</div>
            <Dot ok={status.ffmpeg} /><div>System ffmpeg (fast MP4): {status.ffmpeg ? 'available' : 'not found — MP4 is encoded in the browser with ffmpeg.wasm'}</div>
          </div>
          <p className="mt-4 text-xs text-ink-300">Everything runs on this machine: the script parser, the animation engine, voices, sound effects and music are all built in. No API keys or internet connection are needed.</p>
        </section>

        <section className="card p-5">
          <h3 className="font-semibold mb-2">Storage</h3>
          <p className="text-sm text-ink-300">Projects are stored in this browser’s database{usage ? ` (${(usage.used / 1e6).toFixed(1)} MB used of ${(usage.quota / 1e9).toFixed(1)} GB available)` : ''}. Use “Save project file” in Export to back up a project as JSON, and “Open project file” on the dashboard to restore it.</p>
          <p className="text-xs text-ink-500 mt-2">Keyboard: Space play/pause · ←/→ step a frame (Shift: 1s) · Ctrl+Z / Ctrl+Shift+Z undo/redo · Ctrl+S save now.</p>
        </section>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <div className="flex items-center justify-between gap-4 py-2 border-b border-ink-800 last:border-0"><div><div className="text-sm">{label}</div>{hint && <div className="text-xs text-ink-400">{hint}</div>}</div>{children}</div>; }
function Dot({ ok }: { ok: boolean }) { return <span className={`w-2.5 h-2.5 rounded-full mt-1.5 ${ok ? 'bg-mint' : 'bg-ink-500'}`} />; }
