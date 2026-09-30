import { useEditorStore } from '../store/useEditorStore';
import { useSimulatorStore, type CanvasCommand } from '../store/useSimulatorStore';
import { useProjectStore } from '../store/useProjectStore';
import { useWireupProject } from './project';
import { calculatePinPosition } from '../utils/pinPositionCalculator';
import { readPinInfo } from '../utils/readPinInfo';
import { previewElbow, normalizeWireWaypoints } from '../utils/wireUtils';
import { generateUUID } from '../utils/uuid';
import type { Wire, WireEndpoint } from '../types/wire';
import { proposalSchema, type AIProjectContext, type AIProposal } from './aiClient';

function signature(): string {
  const editor = useEditorStore.getState();
  const sim = useSimulatorStore.getState();
  const project = useProjectStore.getState();
  return JSON.stringify({
    project: project.currentProject,
    wireupProjectId: useWireupProject.getState().project?.id ?? null,
    example: project.currentExampleId,
    activeGroup: editor.activeGroupId,
    activeBoard: sim.activeBoardId,
    groups: editor.fileGroups,
    files: editor.files,
    boards: sim.boards.map(
      ({ id, boardKind, x, y, activeFileGroupId, languageMode, libraries }) => ({
        id,
        boardKind,
        x,
        y,
        activeFileGroupId,
        languageMode,
        libraries,
      }),
    ),
    components: sim.components,
    wires: sim.wires,
  });
}

let previous = signature();
let revision = 0;
const session = generateUUID();
const listeners = new Set<() => void>();
function changed() {
  const next = signature();
  if (next !== previous) {
    previous = next;
    revision += 1;
    listeners.forEach((listener) => listener());
  }
}
useEditorStore.subscribe(changed);
useSimulatorStore.subscribe(changed);
useProjectStore.subscribe(changed);
useWireupProject.subscribe(changed);

export function getProjectRevision(): string {
  return `${session}:${revision}`;
}
export function subscribeProjectRevision(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function captureAIProject(): AIProjectContext {
  const editor = useEditorStore.getState();
  const sim = useSimulatorStore.getState();
  const board = sim.boards.find((item) => item.id === sim.activeBoardId);
  const components = [
    ...sim.boards.map((item) => ({ id: item.id, kind: item.boardKind })),
    ...sim.components.map((item) => ({ id: item.id, kind: item.metadataId })),
  ].map((part) => ({
    ...part,
    pins: [
      ...new Set((readPinInfo(document.getElementById(part.id)) ?? []).map((pin) => pin.name)),
    ],
  }));
  const files = Object.entries(editor.fileGroups).flatMap(([group_id, groupFiles]) =>
    (group_id === editor.activeGroupId ? editor.files : groupFiles).map(({ name, content }) => ({
      group_id,
      name,
      content,
    })),
  );
  if (
    files.length > 64 ||
    components.length > 256 ||
    sim.wires.length > 512 ||
    components.some((part) => part.pins.length > 256)
  ) {
    throw new Error(
      'Workspace exceeds assistant limits (64 files, 256 parts, 512 wires, 256 pins per part).',
    );
  }
  return {
    revision: getProjectRevision(),
    active_group_id: editor.activeGroupId,
    board: board?.boardKind ?? 'none',
    language: board?.languageMode ?? 'arduino',
    libraries: board?.libraries ?? [],
    files,
    components,
    wires: sim.wires.map((wire) => ({
      id: wire.id,
      start: { component_id: wire.start.componentId, pin_name: wire.start.pinName },
      end: { component_id: wire.end.componentId, pin_name: wire.end.pinName },
      removable: !wire.bb,
    })),
  };
}

function resolveEndpoint(endpoint: { component_id: string; pin_name: string }): WireEndpoint {
  const sim = useSimulatorStore.getState();
  const part = sim.components.find((item) => item.id === endpoint.component_id);
  const board = sim.boards.find((item) => item.id === endpoint.component_id);
  if (!part && !board) throw new Error('A proposed component no longer exists.');
  const pins = readPinInfo(document.getElementById(endpoint.component_id));
  if (!pins?.some((pin) => pin.name === endpoint.pin_name)) {
    throw new Error(
      `Pin ${endpoint.component_id}.${endpoint.pin_name} is not rendered. Open the circuit view and retry.`,
    );
  }
  const position = calculatePinPosition(
    endpoint.component_id,
    endpoint.pin_name,
    part ? part.x + 6 : board!.x,
    part ? part.y + 6 : board!.y,
    part ? Number(part.properties.rotation) || 0 : 0,
  );
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new Error('Could not resolve wire pin coordinates. No changes applied.');
  }
  return { componentId: endpoint.component_id, pinName: endpoint.pin_name, ...position };
}

function ensureStopped() {
  const sim = useSimulatorStore.getState();
  if (sim.running || sim.boards.some((board) => board.running)) {
    throw new Error('Stop all simulations before applying or undoing AI changes.');
  }
}

export interface AppliedProposal {
  revision: string;
  canUndo(): boolean;
  undo(): void;
}

export function applyAIProposal(input: AIProposal): AppliedProposal {
  const proposal = proposalSchema.parse(input);
  ensureStopped();
  if (proposal.revision !== getProjectRevision())
    throw new Error('Project changed. Request a fresh proposal before applying.');
  const editor = useEditorStore.getState();
  const sim = useSimulatorStore.getState();
  const seenFiles = new Set<string>();
  const files = proposal.files.map((edit) => {
    const key = JSON.stringify([edit.group_id, edit.name]);
    const existing = editor.fileGroups[edit.group_id]?.find((file) => file.name === edit.name);
    if (!existing || seenFiles.has(key))
      throw new Error('Proposal references an unknown or duplicate file.');
    seenFiles.add(key);
    return { group: edit.group_id, id: existing.id, before: existing.content, after: edit.content };
  });
  const removed: Wire[] = [];
  for (const edit of proposal.circuit) {
    if (edit.op !== 'remove_wire') continue;
    const wire = sim.wires.find((item) => item.id === edit.wire_id);
    if (!wire || wire.bb || removed.some((item) => item.id === wire.id))
      throw new Error('Cannot remove an unknown, protected, or duplicate wire.');
    removed.push(wire);
  }
  function connection(start: WireEndpoint, end: WireEndpoint) {
    return JSON.stringify(
      [
        [start.componentId, start.pinName],
        [end.componentId, end.pinName],
      ].sort(),
    );
  }
  const connections = new Set(
    sim.wires
      .filter((wire) => !removed.includes(wire))
      .map((wire) => connection(wire.start, wire.end)),
  );
  const added: Wire[] = [];
  for (const edit of proposal.circuit) {
    if (edit.op !== 'add_wire') continue;
    const start = resolveEndpoint(edit.start);
    const end = resolveEndpoint(edit.end);
    const key = connection(start, end);
    if (
      (start.componentId === end.componentId && start.pinName === end.pinName) ||
      connections.has(key)
    ) {
      throw new Error('Proposal contains a duplicate or self-connection.');
    }
    connections.add(key);
    const elbow = previewElbow(start, end.x, end.y);
    added.push({
      id: generateUUID(),
      start,
      end,
      color: edit.color,
      waypoints: normalizeWireWaypoints(start, elbow ? [elbow] : [], end),
    });
  }
  if (!files.length && !added.length && !removed.length)
    throw new Error('This proposal contains no changes to apply.');

  function writeFiles(direction: 'before' | 'after') {
    for (const file of files) {
      const state = useEditorStore.getState();
      if (state.activeGroupId === file.group) state.setFileContent(file.id, file[direction]);
      else {
        state.updateGroupFile(file.group, file.id, file[direction]);
        useEditorStore.setState({ codeChangedSinceLastCompile: true });
      }
    }
  }
  let expectedExecute = proposal.revision;
  let expectedUndo = '';
  const command: CanvasCommand = {
    description: 'Wireup AI proposal',
    execute() {
      ensureStopped();
      if (getProjectRevision() !== expectedExecute)
        throw new Error('Project changed; AI apply/redo refused.');
      writeFiles('after');
      removed.forEach((wire) => useSimulatorStore.getState().removeWire(wire.id));
      added.forEach((wire) => useSimulatorStore.getState().addWire(wire));
      expectedUndo = getProjectRevision();
    },
    undo() {
      ensureStopped();
      if (getProjectRevision() !== expectedUndo)
        throw new Error('Project changed; AI undo refused to overwrite newer edits.');
      writeFiles('before');
      added.forEach((wire) => useSimulatorStore.getState().removeWire(wire.id));
      removed.forEach((wire) => useSimulatorStore.getState().addWire(wire));
      expectedExecute = getProjectRevision();
    },
  };
  sim.pushCommand(command);
  const appliedRevision = getProjectRevision();
  const canUndo = () => {
    const state = useSimulatorStore.getState();
    return (
      getProjectRevision() === appliedRevision && state.history[state.historyIndex] === command
    );
  };
  return {
    revision: appliedRevision,
    canUndo,
    undo() {
      ensureStopped();
      if (!canUndo())
        throw new Error(
          'Project changed or another action followed. AI undo refused to overwrite newer edits.',
        );
      useSimulatorStore.getState().undo();
    },
  };
}
