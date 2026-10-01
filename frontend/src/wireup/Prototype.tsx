import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Cable, Check, CircuitBoard, Download, FileCode2, ListChecks, Package, ShieldAlert, Usb } from 'lucide-react';
import { FlashModal } from '../components/simulator/FlashModal';
import { webFlashAvailable } from '../lib/proWebFlash';
import { isTauri } from '../desktop/tauriBridge';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useEditorStore } from '../store/useEditorStore';
import { useVfsStore } from '../store/useVfsStore';
import { BOARD_KIND_FQBN, BOARD_KIND_LABELS } from '../types/board';
import { getProBoard } from '../lib/proBoardRegistry';
import { captureProjectSnapshot, createProject, downloadFile, exportProject, projectFilename, useWireupProject } from './project';
import { buildPrototypeModel, buildSourceArchive, prototypeCsv } from './prototypeModel';
import './Prototype.css';

type Section = 'bom' | 'wires' | 'assembly';

export function Prototype() {
  const boards = useSimulatorStore((state) => state.boards);
  const components = useSimulatorStore((state) => state.components);
  useSimulatorStore((state) => state.wires);
  useSimulatorStore((state) => state.activeBoardId);
  useEditorStore((state) => state.fileGroups);
  useEditorStore((state) => state.folderGroups);
  useEditorStore((state) => state.activeGroupId);
  useEditorStore((state) => state.activeGroupFileId);
  useEditorStore((state) => state.openGroupFileIds);
  useVfsStore((state) => state.boards);
  useVfsStore((state) => state.selectedNodeId);
  const project = useWireupProject((state) => state.project);
  const [section, setSection] = useState<Section>('bom');
  const [flashId, setFlashId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const derived = (() => {
    try {
      const snapshot = captureProjectSnapshot();
      return { snapshot, model: buildPrototypeModel(snapshot), error: '' };
    } catch (err) {
      return { snapshot: null, model: null, error: err instanceof Error ? err.message : 'Cannot derive the prototype.' };
    }
  })();
  const name = project?.name ?? 'Untitled circuit';
  const { snapshot, model } = derived;
  const flashBoard = boards.find((board) => board.id === flashId);
  const fqbnFor = (kind: typeof boards[number]['boardKind']) => getProBoard(kind)?.fqbn ?? BOARD_KIND_FQBN[kind];
  const flashFqbn = flashBoard ? fqbnFor(flashBoard.boardKind) : null;
  const empty = !boards.length && !components.length;

  async function download(kind: 'bom' | 'wires' | 'sources' | 'project') {
    if (!snapshot || !model || busy) return;
    setBusy(true);
    setError('');
    try {
      if (kind === 'sources') downloadFile(await buildSourceArchive(snapshot), projectFilename(name, 'sources.zip'));
      else if (kind === 'project') {
        const current = project ?? createProject(name);
        downloadFile(exportProject({ ...current, snapshot, updatedAt: new Date().toISOString() }), projectFilename(name));
      } else downloadFile(new Blob([prototypeCsv(model, kind)], { type: 'text/csv;charset=utf-8' }), projectFilename(name, `${kind}.csv`));
    } catch (err) { setError(err instanceof Error ? err.message : 'Export failed.'); }
    finally { setBusy(false); }
  }

  return <div className="wu-prototype">
    <header className="wu-prototype-header"><div><span className="wu-prototype-eyebrow">FROM SCREEN TO WORKBENCH</span><h1>Make the leap to hardware.</h1><p>A practical build pack, derived from your current circuit. No invented parts. No hidden connections.</p></div><Link to="/editor"><ArrowLeft size={16} /> Back to simulation</Link></header>
    {(error || derived.error) && <p className="wu-prototype-error" role="alert">{error || derived.error}</p>}
    {empty ? <section className="wu-prototype-empty"><CircuitBoard size={40} /><h2>Your prototype starts with a circuit.</h2><p>Add boards and components in the simulator, or start with an example. Your parts list and wiring guide will appear here.</p><Link to="/editor">Open simulator <ArrowRight size={16} /></Link><Link to="/">Choose a template</Link></section> : model && <>
      <div className="wu-prototype-summary"><div><span className="wu-prototype-project-icon"><CircuitBoard size={25} /></span><div><small>CURRENT WORKSPACE</small><h2>{name}</h2></div></div><dl><div><dt>Physical parts</dt><dd>{model.bom.reduce((count, row) => count + row.quantity, 0)}</dd></div><div><dt>Connections</dt><dd>{model.connections.length}</dd></div><div><dt>Source files</dt><dd>{model.sourceCount}</dd></div></dl></div>
      <div className="wu-prototype-layout"><section className="wu-prototype-guide"><nav className="wu-prototype-tabs" aria-label="Build guide sections">{([{ id: 'bom', label: 'Bill of materials', icon: Package }, { id: 'wires', label: 'Wiring', icon: Cable }, { id: 'assembly', label: 'Assembly', icon: ListChecks }] as const).map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={section === id} onClick={() => setSection(id)}><Icon size={16} />{label}</button>)}</nav>
        {section === 'bom' && <div className="wu-prototype-section"><div className="wu-prototype-section-heading"><div><h2>Everything on your bench.</h2><p>Grouped by part and specification. Virtual instruments are not shopping items.</p></div><button disabled={busy} onClick={() => void download('bom')}><Download size={15} /> CSV</button></div><div className="wu-prototype-table-wrap"><table><caption className="wu-prototype-sr-only">Bill of materials derived from the circuit</caption><thead><tr><th>Part / specification</th><th>Qty</th><th>References</th></tr></thead><tbody>{model.bom.map((row) => <tr key={`${row.kind}:${row.specification}`}><td><strong>{row.label}</strong><small>{row.specification || 'Verify exact hardware model and ratings'}</small></td><td>{row.quantity}</td><td><code>{row.references.join(', ')}</code></td></tr>)}</tbody></table></div></div>}
        {section === 'wires' && <div className="wu-prototype-section"><div className="wu-prototype-section-heading"><div><h2>Every connection, accounted for.</h2><p>Pin-to-pin endpoints from the canvas; not a physical wire-length estimate.</p></div><button disabled={busy} onClick={() => void download('wires')}><Download size={15} /> CSV</button></div>{model.connections.length ? <div className="wu-prototype-table-wrap"><table><caption className="wu-prototype-sr-only">Circuit wiring connections</caption><thead><tr><th>From</th><th>To</th><th>Wire / signal</th></tr></thead><tbody>{model.connections.map((wire) => <tr key={wire.id}><td><code>{wire.from}</code></td><td><code>{wire.to}</code></td><td><span className="wu-prototype-wire-color" style={{ backgroundColor: wire.color }} />{wire.color}<small>{wire.signal} · {wire.seated ? 'Breadboard seating' : 'Jumper connection'}</small><small>{wire.id}</small></td></tr>)}</tbody></table></div> : <p className="wu-prototype-no-wires">No wires in this circuit yet. Add connections in the simulator to generate a wiring list.</p>}</div>}
        {section === 'assembly' && <div className="wu-prototype-section"><div className="wu-prototype-section-heading"><div><h2>One connection at a time.</h2><p>Use this checklist as a build aid. Checked steps are not electrical verification.</p></div></div><ol className="wu-prototype-checklist">{model.instructions.map((instruction, index) => <li key={`${index}:${instruction}`}><label><input type="checkbox" checked={checked.includes(`${index}:${instruction}`)} onChange={(event) => { const key = `${index}:${instruction}`; setChecked((items) => event.target.checked ? [...items, key] : items.filter((item) => item !== key)); }} /><span className="wu-prototype-step">{checked.includes(`${index}:${instruction}`) ? <Check size={14} /> : index + 1}</span><span>{instruction}</span></label></li>)}</ol></div>}
      </section><aside className="wu-prototype-sidebar"><section className="wu-prototype-export"><span className="wu-prototype-eyebrow">TAKE IT WITH YOU</span><h2>Your build pack</h2><p>Export the live workspace, including unsaved changes.</p><button disabled={busy} onClick={() => void download('project')}><Download size={17} /><span>Project backup<small>Importable .wireup.json</small></span><ArrowRight size={15} /></button><button disabled={busy} onClick={() => void download('sources')}><FileCode2 size={17} /><span>Source archive<small>Firmware, uploads & circuit · ZIP</small></span><ArrowRight size={15} /></button><button disabled={busy} onClick={() => void download('bom')}><Package size={17} /><span>Bill of materials<small>Spreadsheet-ready CSV</small></span><ArrowRight size={15} /></button><button disabled={busy} onClick={() => void download('wires')}><Cable size={17} /><span>Wiring list<small>Pin-to-pin connections · CSV</small></span><ArrowRight size={15} /></button>{busy && <small role="status">Preparing download…</small>}</section><section className="wu-prototype-flash"><Usb size={21} /><h2>Meet your real board.</h2><p>{isTauri() ? 'Desktop uploader available. Select an actual detected port in the upload dialog.' : boards.some(board => webFlashAvailable(board.boardKind)) ? 'A browser upload integration is available for a supported target. Device authorization is required in the dialog.' : 'This browser build has no direct hardware uploader installed. Supported firmware downloads remain available; use an external uploader or the desktop integration.'}</p><p>The existing hardware uploader compiles before flashing and reports device support. No upload happens until you confirm in the dialog.</p>{boards.map((board) => <button key={board.id} disabled={!fqbnFor(board.boardKind) || board.running} onClick={() => setFlashId(board.id)}><Usb size={15} /><span>Flash {board.name ?? BOARD_KIND_LABELS[board.boardKind] ?? board.boardKind}<small>{board.id} · {fqbnFor(board.boardKind) ?? 'No target'}{board.running ? ' · Stop simulation first' : !fqbnFor(board.boardKind) ? ' · No hardware target configured' : ''}</small></span></button>)}{!boards.length && <p>No programmable boards in this circuit.</p>}</section></aside></div>
      <section className="wu-prototype-warnings" aria-labelledby="wu-safety-title"><ShieldAlert size={22} /><div><h2 id="wu-safety-title">Before you power anything</h2><ul>{model.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div></section>
    </>}
    {flashBoard && flashFqbn && <FlashModal board={flashBoard} fqbn={flashFqbn} onClose={() => setFlashId(null)} />}
  </div>;
}
