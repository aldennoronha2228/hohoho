import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Cable, CircuitBoard, Download, Maximize, Minus, Plus, Tag } from 'lucide-react';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { ComponentRegistry } from '../services/ComponentRegistry';
import { BOARD_KIND_LABELS } from '../types/board';
import type { BoardKind } from '../types/board';
import { getProBoard } from '../lib/proBoardRegistry';
import { captureProjectSnapshot, downloadFile, projectFilename, useWireupProject } from './project';
import { buildPrototypeModel, prototypeCsv } from './prototypeModel';
import { buildSchematicModel, fitSchematic, zoomSchematic } from './schematicModel';
import type { SchematicView } from './schematicModel';
import './Schematic.css';

export interface SchematicProps {
  className?: string;
}
const registry = ComponentRegistry.getInstance();

/** Read-only projection of the live simulator circuit; the parent owns the parts sidebar. */
export function Schematic({ className = '' }: SchematicProps) {
  const boards = useSimulatorStore((state) => state.boards);
  const components = useSimulatorStore((state) => state.components);
  const wires = useSimulatorStore((state) => state.wires);
  const project = useWireupProject((state) => state.project);
  const metadataVersion = useSyncExternalStore(registry.subscribe, registry.getVersion, registry.getVersion);
  const [metadataReady, setMetadataReady] = useState(registry.isLoaded);
  const [metadataError, setMetadataError] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [labels, setLabels] = useState(true);
  const [selection, setSelection] = useState<{ kind: 'part' | 'net'; id: string } | null>(null);
  const [view, setView] = useState<SchematicView>({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const stage = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const userMoved = useRef(false);
  const gridId = useId().replace(/:/g, '');
  const titleId = `${gridId}-title`;

  useEffect(() => {
    let active = true;
    void registry.load().then(() => { if (active) setMetadataReady(true); }).catch(() => { if (active) setMetadataError(true); });
    return () => { active = false; };
  }, []);
  const model = useMemo(() => {
    const labelFor = (kind: string) => (metadataReady || metadataVersion > 0 ? registry.getById(kind)?.name : undefined) ?? getProBoard(kind)?.label ?? BOARD_KIND_LABELS[kind as BoardKind];
    return buildSchematicModel(boards, components, wires, labelFor);
  }, [boards, components, wires, metadataVersion, metadataReady]);
  const modelRef = useRef(model);
  useEffect(() => { modelRef.current = model; }, [model]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setSize({ width, height });
      if (!userMoved.current) setView(fitSchematic(modelRef.current.bounds, width, height));
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(element);
    window.addEventListener('resize', resize);
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize); };
  }, []);
  useEffect(() => {
    if (!userMoved.current) setView(fitSchematic(model.bounds, size.width, size.height));
  }, [model.bounds, size]);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      userMoved.current = true;
      const rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      setView((current) => zoomSchematic(current, Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  const fit = useCallback(() => {
    userMoved.current = false;
    setView(fitSchematic(model.bounds, size.width, size.height));
  }, [model.bounds, size]);
  const zoom = (factor: number) => {
    userMoved.current = true;
    setView((current) => zoomSchematic(current, factor, { x: size.width / 2, y: size.height / 2 }));
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointers.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const next = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
    pointers.current.set(event.pointerId, next);
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    if (!dx && !dy) return;
    userMoved.current = true;
    if (other) {
      const distance = Math.hypot(previous.x - other.x, previous.y - other.y);
      const factor = distance > 1 ? Math.hypot(next.x - other.x, next.y - other.y) / distance : 1;
      const anchor = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
      setView((current) => { const scaled = zoomSchematic(current, factor, anchor); return { ...scaled, x: scaled.x + dx / 2, y: scaled.y + dy / 2 }; });
    } else setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  };
  const pointerEnd = (event: PointerEvent<SVGSVGElement>) => { pointers.current.delete(event.pointerId); };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === '+' || event.key === '=') zoom(1.2);
    else if (event.key === '-') zoom(1 / 1.2);
    else if (event.key.toLowerCase() === 'f' || event.key === '0') fit();
    else if (event.key === 'Escape') setSelection(null);
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      userMoved.current = true;
      const step = event.shiftKey ? 100 : 40;
      setView((current) => ({ ...current, x: current.x + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0), y: current.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0) }));
    } else return;
    event.preventDefault();
  };
  const exportBom = () => {
    setDownloadError('');
    try {
      const bom = buildPrototypeModel(captureProjectSnapshot());
      for (const row of bom.bom) row.label = registry.getById(row.kind)?.name ?? getProBoard(row.kind)?.label ?? row.label;
      downloadFile(new Blob([prototypeCsv(bom, 'bom')], { type: 'text/csv;charset=utf-8' }), projectFilename(project?.name ?? 'Untitled circuit', 'bom.csv'));
    } catch (error) { setDownloadError(error instanceof Error ? error.message : 'Unable to export this circuit.'); }
  };
  const selectedPart = selection?.kind === 'part' ? model.parts.find((part) => part.id === selection.id) : undefined;
  const selectedNet = selection?.kind === 'net' ? model.nets.find((net) => net.id === selection.id) : undefined;
  const highlightedWires = new Set(selectedNet?.wireIds ?? (selectedPart ? model.routes.filter(({ wire }) => wire.start.componentId === selectedPart.id || wire.end.componentId === selectedPart.id).map(({ wire }) => wire.id) : []));
  const empty = !model.parts.length;

  return <section className={`wu-schematic ${className}`} aria-label="Circuit schematic">
    <header className="wu-schematic-header">
      <div><CircuitBoard size={16} /><strong>Schematic</strong><span className="wu-schematic-badge">CONNECTIVITY</span></div>
      <button onClick={fit} disabled={empty}><Maximize size={14} /> Auto-arrange / fit</button>
    </header>
    <div className="wu-schematic-body">
      <div className="wu-schematic-stage" ref={stage}>
        <svg ref={svg} className="wu-schematic-svg" width="100%" height="100%" tabIndex={0} role="img" aria-labelledby={titleId} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd} onKeyDown={onKeyDown}>
          <title id={titleId}>{project?.name ?? 'Current circuit'}: {model.parts.length} parts, {model.routes.length} wires, {model.nets.length} connected nets. Drag to pan, scroll or pinch to zoom. Arrow keys pan, plus and minus zoom, F fits.</title>
          <defs><pattern id={gridId} width={20 * view.scale} height={20 * view.scale} patternUnits="userSpaceOnUse" x={view.x} y={view.y}><circle cx={view.scale} cy={view.scale} r={0.8} fill="var(--wu-grid)" /></pattern></defs>
          <rect width="100%" height="100%" fill={`url(#${gridId})`} />
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            <g className="wu-schematic-wires">{model.routes.map(({ wire, netId, points }) => <g key={wire.id} className={highlightedWires.has(wire.id) ? 'is-selected' : highlightedWires.size ? 'is-muted' : ''}>
              <title>{netId} · {wire.id}: {wire.start.componentId}.{wire.start.pinName} → {wire.end.componentId}.{wire.end.pinName}{wire.bb ? ' · breadboard seating' : ''}{wire.signalType ? ` · ${wire.signalType}` : ''}</title>
              <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} stroke={wire.color || '#b8f15a'} vectorEffect="non-scaling-stroke" className={wire.bb ? 'wu-schematic-seating' : ''} />
            </g>)}</g>
            {model.parts.map((part) => <g key={part.id} className={`wu-schematic-symbol ${part.board ? 'is-board' : ''} ${selectedPart?.id === part.id ? 'is-selected' : ''}`}>
              <title>{part.label} · {part.id}{part.specification ? ` · ${part.specification}` : ''}</title>
              <rect x={part.x} y={part.y} width={part.width} height={part.height} />
              <text className="wu-schematic-part-label" x={part.x + 12} y={part.y + 22}>{part.label.length > Math.floor((part.width - 24) / 7) ? `${part.label.slice(0, Math.floor((part.width - 24) / 7) - 1)}…` : part.label}</text>
              <text className="wu-schematic-reference" x={part.x + 12} y={part.y + 40}>{part.id.length > 28 ? `${part.id.slice(0, 27)}…` : part.id}</text>
              {part.pins.map((pin) => <g key={pin.key}>
                <title>{part.id}.{pin.name} · {pin.connections} wire endpoint{pin.connections === 1 ? '' : 's'}</title>
                <line x1={pin.x} x2={pin.side === 'left' ? part.x : part.x + part.width} y1={pin.y} y2={pin.y} />
                <circle cx={pin.x} cy={pin.y} r={pin.connections > 1 ? 4 : 3} />
                {labels && <text className="wu-schematic-pin-label" x={pin.side === 'left' ? part.x + 8 : part.x + part.width - 8} y={pin.y + 4} textAnchor={pin.side === 'left' ? 'start' : 'end'}>{pin.name}</text>}
              </g>)}
              {!part.pins.length && <text className="wu-schematic-unwired" x={part.x + 12} y={part.y + 73}>No wired pins</text>}
            </g>)}
          </g>
        </svg>
        {empty && <div className="wu-schematic-empty"><CircuitBoard size={38} /><h2>No circuit on this sheet.</h2><p>Add a board or component in the simulator. Its actual pin connections will appear here.</p></div>}
        <div className="wu-schematic-controls" role="toolbar" aria-label="Schematic viewport controls">
          <button aria-label="Pan left" title="Pan left" onClick={() => { userMoved.current = true; setView((current) => ({ ...current, x: current.x + 80 })); }}>←</button>
          <button aria-label="Pan right" title="Pan right" onClick={() => { userMoved.current = true; setView((current) => ({ ...current, x: current.x - 80 })); }}>→</button>
          <span className="wu-schematic-control-divider" />
          <button aria-label="Zoom out" onClick={() => zoom(1 / 1.2)} disabled={view.scale <= 0.01}><Minus size={15} /></button>
          <output aria-label="Zoom level">{Math.round(view.scale * 100)}%</output>
          <button aria-label="Zoom in" onClick={() => zoom(1.2)} disabled={view.scale >= 4}><Plus size={15} /></button>
          <button aria-label="Fit circuit to view" title="Fit circuit (F)" onClick={fit}><Maximize size={15} /></button>
          <span className="wu-schematic-control-divider" />
          <button aria-pressed={labels} onClick={() => setLabels((current) => !current)}><Tag size={14} /><span>Labels</span></button>
        </div>
        <span className="wu-schematic-hint">Drag to pan · Scroll / pinch to zoom · F to fit</span>
      </div>
      <aside className="wu-schematic-sheet" aria-label="Sheet connectivity summary">
        <div className="wu-schematic-sheet-title">SHEET <span>LIVE WORKSPACE</span></div>
        <dl className="wu-schematic-stats"><div><dt>Parts</dt><dd>{model.parts.length}</dd></div><div><dt>Connected nets</dt><dd>{model.nets.length}</dd></div><div><dt>Wires</dt><dd>{model.routes.length}</dd></div></dl>
        <button className="wu-schematic-download" disabled={empty} onClick={exportBom}><Download size={14} /> BOM CSV</button>
        {downloadError && <p className="wu-schematic-error" role="alert">{downloadError}</p>}
        <p className="wu-schematic-note">Only wired pins are shown. Crossings are not junctions; dots mark actual endpoints. Registered internal pin groups are included in nets. No ERC or voltage analysis.</p>
        {metadataError && <p className="wu-schematic-note">Metadata unavailable; saved type names are shown.</p>}
        {model.unresolved.length > 0 && <details className="wu-schematic-warning"><summary>{model.unresolved.length} unresolved wire{model.unresolved.length === 1 ? '' : 's'}</summary><p>Missing parts; these wires are not drawn or counted as connected nets.</p><ul>{model.unresolved.map((wire) => <li key={wire.id}>{wire.id}: {wire.start.componentId}.{wire.start.pinName} → {wire.end.componentId}.{wire.end.pinName}</li>)}</ul></details>}
        <details open className="wu-schematic-list"><summary><CircuitBoard size={13} /> Parts ({model.parts.length})</summary><ul>{model.parts.map((part) => <li key={part.id}><button aria-pressed={selectedPart?.id === part.id} onClick={() => setSelection((current) => current?.kind === 'part' && current.id === part.id ? null : { kind: 'part', id: part.id })}><strong>{part.label}</strong><code>{part.id}</code><small>{part.pins.length} wired pins{part.specification ? ` · ${part.specification}` : ''}</small></button></li>)}</ul></details>
        <details className="wu-schematic-list"><summary><Cable size={13} /> Connected nets ({model.nets.length})</summary><ul>{model.nets.map((net) => <li key={net.id}><button aria-pressed={selectedNet?.id === net.id} onClick={() => setSelection((current) => current?.kind === 'net' && current.id === net.id ? null : { kind: 'net', id: net.id })}><strong>{net.id} <small>{net.wireIds.length} wire{net.wireIds.length === 1 ? '' : 's'}</small></strong>{net.endpoints.map((endpoint) => <code key={JSON.stringify(endpoint)}>{endpoint.componentId}.{endpoint.pinName}</code>)}</button></li>)}</ul>{!model.nets.length && <p className="wu-schematic-note">No pin-to-pin connections yet.</p>}</details>
      </aside>
    </div>
  </section>;
}
