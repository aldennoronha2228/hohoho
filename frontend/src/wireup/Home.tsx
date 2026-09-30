import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CircuitBoard,
  Copy,
  FolderOpen,
  Gauge,
  Import,
  Lightbulb,
  Pencil,
  Search,
  SlidersHorizontal,
  TrafficCone,
  Trash2,
  X,
} from 'lucide-react';
import { exampleProjects, type ExampleProject } from '../data/examples';
import { Assistant } from './Assistant';
import {
  createProjectFromExample,
  deleteProject,
  duplicateProject,
  importProject,
  listProjects,
  openProject,
  renameProject,
  saveCurrentProject,
  useWireupProject,
  type ProjectSummary,
} from './project';
import './Home.css';

export function Home() {
  const navigate = useNavigate();
  const session = useWireupProject();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<ProjectSummary | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const starters = [
    { id: 'blink-led', label: 'Blink an LED', icon: Lightbulb, tone: 'blue' },
    { id: 'traffic-light', label: 'Build a traffic light', icon: TrafficCone, tone: 'amber' },
    { id: 'uno-servo', label: 'Sweep a servo', icon: Gauge, tone: 'coral' },
    { id: 'uno-potentiometer', label: 'Read a sensor', icon: SlidersHorizontal, tone: 'lavender' },
  ];
  const templates = ['blink-led', 'traffic-light', 'uno-servo', 'uno-potentiometer']
    .map((id) =>
      exampleProjects.find(
        (example) =>
          example.id === id &&
          (example.boards?.length
            ? example.boards.every((board) => board.boardKind === 'arduino-uno')
            : (example.boardType ?? 'arduino-uno') === 'arduino-uno'),
      ),
    )
    .filter((example): example is ExampleProject => Boolean(example));

  useEffect(() => {
    let mounted = true;
    listProjects()
      .then((items) => {
        if (mounted) setProjects(items);
      })
      .catch((err: unknown) => {
        if (mounted) setError(err instanceof Error ? err.message : 'Cannot read local projects.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Project operation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function preserveWorkspace() {
    const current = useWireupProject.getState();
    if (current.project && current.dirty) await saveCurrentProject();
  }

  async function startTemplate(example: ExampleProject) {
    await preserveWorkspace();
    await createProjectFromExample(example);
    navigate('/editor');
  }

  function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    void run(async () => {
      await renameProject(editing.id, name);
      setProjects(await listProjects());
      setEditing(null);
    });
  }

  const visible = projects.filter((project) =>
    `${project.name} ${project.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="wu-home">
      <section className="wu-home-hero" aria-labelledby="wu-home-title">
        <div className="wu-home-wordmark">
          <CircuitBoard size={25} strokeWidth={1.6} aria-hidden="true" />
          <span>Wireup</span>
        </div>
        <h1 id="wu-home-title">
          Build something
          <br />
          extraordinary.
        </h1>
        <div className="wu-home-prompt">
          <Assistant className="wu-home-assistant" />
        </div>
        <div className="wu-home-starters">
          <p>OR BUILD ONE OF THESE</p>
          <div className="wu-home-starter-list">
            {starters.map(({ id, label, icon: Icon, tone }) => {
              const example = templates.find((template) => template.id === id);
              return (
                example && (
                  <button
                    key={id}
                    className={`wu-home-starter wu-home-starter--${tone}`}
                    disabled={busy}
                    onClick={() => void run(() => startTemplate(example))}
                  >
                    <span>
                      <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
                    </span>
                    {label}
                  </button>
                )
              );
            })}
          </div>
        </div>
      </section>
      {error && (
        <div className="wu-home-error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      <section id="templates" className="wu-home-templates" aria-labelledby="wu-template-title">
        <div className="wu-home-section-title">
          <h2 id="wu-template-title">Discover templates</h2>
          <Link to="/examples">
            Explore projects <ArrowRight size={15} />
          </Link>
        </div>
        <div className="wu-home-template-grid">
          {templates.map((example) => (
            <button
              key={example.id}
              className={`wu-home-template wu-home-template--${starters.find((starter) => starter.id === example.id)?.tone}`}
              disabled={busy}
              onClick={() => void run(() => startTemplate(example))}
            >
              <span className="wu-home-template-image">
                <img
                  src={`/examples-thumbs/${example.id}.webp`}
                  alt=""
                  loading="lazy"
                  width={1200}
                  height={720}
                />
              </span>
              <span className="wu-home-template-copy">
                <span className="wu-home-template-category">Arduino Uno · {example.category}</span>
                <strong>{example.title.replace(/^Uno:\s*/, '')}</strong>
                <span className="wu-home-template-description">{example.description}</span>
                <span className="wu-home-template-bottom">
                  {example.difficulty}
                  <ArrowRight size={17} aria-hidden="true" />
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section id="projects" className="wu-home-projects" aria-labelledby="wu-project-title">
        <span id="history" />
        <div className="wu-home-section-title">
          <div>
            <h2 id="wu-project-title">Your projects</h2>
            <p>Pick up where you left off. Saved locally on this device.</p>
          </div>
          <button
            className="wu-home-outline"
            disabled={busy}
            onClick={() => upload.current?.click()}
          >
            <Import size={15} /> Import project
          </button>
          <input
            ref={upload}
            type="file"
            accept=".json,.vlx,application/json"
            hidden
            aria-label="Import project file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file)
                void run(async () => {
                  await preserveWorkspace();
                  const imported = await importProject(file);
                  await openProject(imported.id);
                  navigate('/editor');
                });
            }}
          />
        </div>
        <label className="wu-home-search">
          <Search size={16} />
          <input
            type="search"
            placeholder="Find a project…"
            aria-label="Find a project"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {loading ? (
          <p role="status" className="wu-home-empty">
            Opening your local workbench…
          </p>
        ) : visible.length ? (
          <div className="wu-home-project-grid">
            {visible.map((project) => (
              <article className="wu-home-project" key={project.id}>
                <button
                  className="wu-home-project-open"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await preserveWorkspace();
                      await openProject(project.id);
                      navigate('/editor');
                    })
                  }
                >
                  <span className="wu-home-project-icon">
                    <FolderOpen size={21} />
                  </span>
                  <strong>{project.name}</strong>
                  <p>{project.description || 'An idea in progress.'}</p>
                  <span>
                    {project.boardCount} boards · {project.componentCount} parts ·{' '}
                    {project.wireCount} wires
                  </span>
                  <small>Edited {new Date(project.updatedAt).toLocaleDateString()}</small>
                </button>
                <div className="wu-home-project-actions">
                  <button
                    disabled={busy}
                    aria-label={`Rename ${project.name}`}
                    onClick={() => {
                      setEditing(project);
                      setName(project.name);
                    }}
                  >
                    <Pencil size={14} /> Rename
                  </button>
                  <button
                    disabled={busy}
                    aria-label={`Duplicate ${project.name}`}
                    onClick={() =>
                      void run(async () => {
                        if (session.project?.id === project.id) await preserveWorkspace();
                        await duplicateProject(project.id);
                        setProjects(await listProjects());
                      })
                    }
                  >
                    <Copy size={14} /> Duplicate
                  </button>
                  <button
                    disabled={busy}
                    aria-label={`Delete ${project.name}`}
                    onClick={() => setRemoving(project)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="wu-home-empty">
            <FolderOpen size={28} />
            <h3>{query ? 'No matching projects' : 'Good ideas start somewhere.'}</h3>
            <p>
              {query
                ? 'Try another name or description.'
                : 'Choose a template above or import a project to start your local collection.'}
            </p>
          </div>
        )}
        <div className="wu-home-project-footer">
          <p className="wu-home-storage-note">
            Stored on this device, in this browser. Export a backup from Prototype before clearing
            browser data.
          </p>
          <Link className="wu-home-workspace" to="/editor">
            {session.project ? `Continue ${session.project.name}` : 'Open circuit workspace'}
            <ArrowRight size={15} />
          </Link>
        </div>
      </section>
      {(editing || removing) && (
        <div className="wu-modal-backdrop">
          <section
            className="wu-modal wu-home-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wu-project-dialog-title"
          >
            <h2 id="wu-project-dialog-title">{editing ? 'Rename project' : 'Delete project?'}</h2>
            {editing ? (
              <form onSubmit={submitRename}>
                <label htmlFor="wu-project-name">Project name</label>
                <input
                  id="wu-project-name"
                  autoFocus
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <div>
                  <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <button type="submit" disabled={busy || !name.trim()}>
                    Save name
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p>Delete “{removing?.name}” from this browser? This cannot be undone.</p>
                <div>
                  <button disabled={busy} onClick={() => setRemoving(null)}>
                    Keep project
                  </button>
                  <button
                    className="wu-home-danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await deleteProject(removing!.id);
                        setProjects(await listProjects());
                        setRemoving(null);
                      })
                    }
                  >
                    Delete project
                  </button>
                </div>
              </>
            )}
            {error && <p role="alert">{error}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
