import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link as NavLink, useLocation } from 'react-router-dom';
import { ThemeToggle } from '../components/layout/ThemeToggle';
import { Box, Cable, Check, ChevronDown, CircuitBoard, Code2, FolderOpen, History, Home as HomeIcon, LayoutGrid, Menu, MessageSquare, Plus, Settings, Sparkles, X } from 'lucide-react';
import { openProject, saveCurrentProject, startProjectAutosave, useWireupProject } from './project';
import { useStudioState } from './studioState';
import { Assistant } from './Assistant';
import './wireup.css';

export function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const session = useWireupProject();
  const editing = /\/(editor|example\/)/.test(location.pathname);
  const { surface, setSurface } = useStudioState();
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const closeAbout = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const autosave = startProjectAutosave();
    const save = () => { void saveCurrentProject().catch(() => {}); };
    window.addEventListener('wireup:save', save);
    return () => { autosave.dispose(); window.removeEventListener('wireup:save', save); };
  }, []);
  const [restoring, setRestoring] = useState(() => /\/(editor|prototype|build)\/?$/.test(location.pathname) && Boolean(localStorage.getItem('wireup-active-project')));
  useEffect(() => {
    if (!restoring) return;
    const id = localStorage.getItem('wireup-active-project');
    void (id ? openProject(id) : Promise.resolve()).catch(error => {
      useWireupProject.setState({ error: error instanceof Error ? error.message : String(error) });
      localStorage.removeItem('wireup-active-project');
    }).finally(() => setRestoring(false));
  }, [restoring]);
  useEffect(() => { if (aboutOpen) closeAbout.current?.focus(); }, [aboutOpen]);
  useEffect(() => { if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })); }, [location.hash, location.pathname]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAboutOpen(false); setNavigationOpen(false); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  return <div className={`wireup-shell ${editing ? 'wireup-shell--editor' : 'wireup-shell--builder'}`}>
    <header className="wu-header">
      <div className="wu-mode-switch"><NavLink to="/" className={!editing ? 'active' : ''}><Code2 size={14}/>Workspace</NavLink><NavLink to="/editor" className={editing ? 'active' : ''}><CircuitBoard size={14}/>Editor</NavLink></div>
      {editing && <nav className="wu-studio-tabs" aria-label="Studio views"><button className={surface === 'circuit' ? 'active' : ''} onClick={() => setSurface('circuit')}><Box size={13}/>Circuit</button><button className={surface === 'schematic' ? 'active' : ''} onClick={() => setSurface('schematic')}><Cable size={13}/>Schematic<span>BETA</span></button></nav>}
      <div className="wu-header-actions"><ThemeToggle className="wu-theme-toggle"/><NavLink to="/prototype"><Check size={13}/>Build pack</NavLink><button aria-label="Settings" onClick={() => setAboutOpen(true)}><Settings size={13}/><span>Settings</span></button>{editing && <button className="wu-assistant-toggle" aria-pressed={assistantOpen} onClick={() => setAssistantOpen(!assistantOpen)}><Sparkles size={13}/>AI Assistant</button>}{!editing && <button className="wu-mobile-menu" aria-label="Toggle navigation" onClick={() => setNavigationOpen(!navigationOpen)}><Menu size={17}/></button>}</div>
    </header>
    <div className="wu-body">
      {!editing && <aside className={`wu-navigation ${navigationOpen ? 'is-open' : ''}`} aria-label="Builder navigation">
        <NavLink to="/#templates" className="wu-new-project" onClick={() => setNavigationOpen(false)}><Plus size={15}/>New project</NavLink>
        <nav><NavLink to="/" className={location.pathname === '/' && !location.hash ? 'active' : ''} onClick={() => setNavigationOpen(false)}><HomeIcon size={15}/>Home</NavLink><NavLink to="/history" className={location.pathname.endsWith('/history') ? 'active' : ''} onClick={() => setNavigationOpen(false)}><History size={15}/>History</NavLink><NavLink to="/#projects" className={location.hash === '#projects' ? 'active' : ''} onClick={() => setNavigationOpen(false)}><LayoutGrid size={15}/>Projects</NavLink><NavLink to="/#templates" className={location.hash === '#templates' ? 'active' : ''} onClick={() => setNavigationOpen(false)}><LayoutGrid size={15}/>Templates</NavLink><button onClick={() => setAboutOpen(true)}><Settings size={15}/>Settings</button></nav>
        <div className="wu-navigation-bottom"><div className="wu-local-note"><span>Project storage</span><strong>Local</strong><div/><small>Saved in this browser · export backups</small></div><NavLink className="wu-build-pack-link" to="/prototype"><FolderOpen size={14}/>Open build pack</NavLink><NavLink to="/examples"><LayoutGrid size={14}/>Explore examples</NavLink><button onClick={() => setAboutOpen(true)}><MessageSquare size={14}/>About & acknowledgments</button><NavLink className="wu-local-profile" to="/" aria-label="Wireup home"><span>W</span>Wireup workspace<ChevronDown size={13}/></NavLink></div>
      </aside>}
      <main className="wu-main">{restoring ? <p className="wu-restoring">Restoring your Wireup project…</p> : children}</main>
      {editing && assistantOpen && <aside className="wu-assistant"><div className="wu-panel-heading"><span><Sparkles size={14}/>Wireup <small>· {session.project?.name ?? 'Current circuit'}</small></span><button aria-label="Close assistant" onClick={() => setAssistantOpen(false)}><X size={15}/></button></div><Assistant/></aside>}
    </div>
    {(session.error || session.saving || session.dirty) && <div className="wu-save-notice" role="status">{session.error ? `Save failed: ${session.error}` : session.saving ? 'Saving locally…' : 'Unsaved changes'}</div>}
    {aboutOpen && <div className="wu-modal-backdrop" onClick={() => setAboutOpen(false)}><section className="wu-modal" role="dialog" aria-modal="true" aria-label="About Wireup" onClick={e => e.stopPropagation()}><button ref={closeAbout} className="wu-modal-close" aria-label="Close about" onClick={() => setAboutOpen(false)}><X size={18}/></button><CircuitBoard size={30}/><h2>Wireup settings & acknowledgments</h2><p>Projects are saved locally in this browser. Export a backup from Build pack before clearing site data.</p><p>AI requires a server-side provider. Configure <code>AI_API_KEY</code>, optionally <code>AI_BASE_URL</code> and <code>AI_MODEL</code>, then restart the backend.</p><p>Built on <a href="https://github.com/davidmonterocrespo24/velxio" target="_blank" rel="noreferrer">Velxio</a>, copyright © 2025 David Montero Crespo, under AGPLv3. Wokwi Elements, avr8js, rp2040js and ngspice retain their respective licenses.</p><p>Circuit is the existing interactive 2D simulator. Schematic shows project connectivity, not a verified electrical design. Simulation does not certify electrical safety.</p><a href="/about.html" target="_blank" rel="noreferrer">Full acknowledgments ↗</a></section></div>}
  </div>;
}
