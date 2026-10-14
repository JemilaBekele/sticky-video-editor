import { useEffect } from 'react';
import { useStore, setView, undo, redo, restoreLast, type View, saveNow } from './store/store';
import { Icon } from './ui/icons';
import Dashboard from './components/Dashboard';
import ScriptGenerator from './components/ScriptGenerator';
import Storyboard from './components/Storyboard';
import Editor from './components/Editor';
import ExportView from './components/Export';
import SettingsView from './components/Settings';
import CharactersView from './components/Characters';
import BatchView, { useBatchRunning } from './components/Batch';
import { attachProject } from './store/playback';

const NAV: { id: View; label: string; icon: (p: any) => JSX.Element; needsProject?: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Icon.Home },
  { id: 'script', label: 'Script Generator', icon: Icon.Script, needsProject: true },
  { id: 'storyboard', label: 'Storyboard', icon: Icon.Board, needsProject: true },
  { id: 'editor', label: 'Animation Editor', icon: Icon.Film, needsProject: true },
  { id: 'characters', label: 'Characters', icon: Icon.User, needsProject: true },
  { id: 'export', label: 'Video Export', icon: Icon.Export, needsProject: true },
  { id: 'batch', label: 'Batch videos', icon: Icon.Copy },
  { id: 'settings', label: 'Settings', icon: Icon.Settings },
];

export default function App() {
  const view = useStore(s => s.view);
  const project = useStore(s => s.current);
  const saveState = useStore(s => s.saveState);
  const toast = useStore(s => s.toast);
  const canUndo = useStore(s => s.past.length > 0);
  const canRedo = useStore(s => s.future.length > 0);
  const batchRunning = useBatchRunning();

  useEffect(() => { restoreLast(); }, []);
  useEffect(() => { if (project) attachProject(project); }, [project]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(true); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="h-full flex bg-ink-950 text-ink-200">
      {/* Sidebar */}
      <aside className="w-[220px] shrink-0 border-r border-ink-800 bg-ink-900 flex flex-col">
        <div className="flex items-center gap-2 px-4 h-14 border-b border-ink-800">
          <span className="w-8 h-8 rounded-lg bg-accent-500 text-ink-950 grid place-items-center"><Icon.Logo size={20} /></span>
          <div className="leading-tight"><div className="font-bold text-sm tracking-tight">Sticky Motion <span className="text-accent-500">AI</span></div><div className="text-[10px] text-ink-400">script → stickman video</div></div>
        </div>
        <nav className="p-2 flex-1 space-y-0.5">
          {NAV.map(n => {
            // while a batch runs it owns the open project, so other pages stay closed
            const disabled = (n.needsProject && !project) || (batchRunning && n.id !== 'batch');
            return (
              <button key={n.id} disabled={disabled} title={batchRunning && n.id !== 'batch' ? 'Available when the batch has finished' : undefined} onClick={() => setView(n.id)} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${view === n.id ? 'bg-ink-800 text-white' : 'text-ink-300 hover:bg-ink-850 hover:text-white'} disabled:opacity-30 disabled:cursor-not-allowed`}>
                <n.icon size={16} className={view === n.id ? 'text-accent-500' : ''} />{n.label}
              </button>
            );
          })}
        </nav>
        {project && (
          <div className="p-3 border-t border-ink-800 text-xs">
            <div className="label">Current project</div>
            <div className="truncate font-medium text-ink-200 mt-1">{project.name}</div>
            <div className="text-ink-400 mt-0.5">{project.scenes.length} scene{project.scenes.length === 1 ? '' : 's'} · {project.characters.length} character{project.characters.length === 1 ? '' : 's'}</div>
          </div>
        )}
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 border-b border-ink-800 flex items-center justify-between px-4 bg-ink-900/60 backdrop-blur">
          <div className="text-sm font-semibold">{NAV.find(n => n.id === view)?.label}</div>
          <div className="flex items-center gap-2">
            {project && view !== 'dashboard' && (
              <>
                <button className="btn-ghost !py-1 !px-2" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}><Icon.Undo size={14} /></button>
                <button className="btn-ghost !py-1 !px-2" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}><Icon.Redo size={14} /></button>
                <span className={`text-xs flex items-center gap-1.5 px-2 py-1 rounded-md ${saveState === 'saved' ? 'text-mint' : saveState === 'error' ? 'text-coral' : 'text-accent-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${saveState === 'saved' ? 'bg-mint' : saveState === 'error' ? 'bg-coral' : 'bg-accent-400 animate-pulse'}`} />
                  {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Unsaved changes'}
                </span>
              </>
            )}
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-hidden">
          {view === 'dashboard' && <Dashboard />}
          {view === 'script' && project && <ScriptGenerator />}
          {view === 'storyboard' && project && <Storyboard />}
          {view === 'editor' && project && <Editor />}
          {view === 'characters' && project && <CharactersView />}
          {view === 'export' && project && <ExportView />}
          {view === 'settings' && <SettingsView />}
          {view === 'batch' && <BatchView />}
          {view !== 'dashboard' && view !== 'settings' && view !== 'batch' && !project && <div className="h-full grid place-items-center text-ink-400">Open or create a project first.</div>}
        </main>
      </div>

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 max-w-md rounded-xl px-4 py-3 text-sm shadow-xl border ${toast.kind === 'error' ? 'bg-coral/15 border-coral/40 text-coral' : toast.kind === 'success' ? 'bg-mint/10 border-mint/40 text-mint' : 'bg-ink-800 border-ink-600 text-ink-200'}`}>{toast.text}</div>
      )}
    </div>
  );
}
