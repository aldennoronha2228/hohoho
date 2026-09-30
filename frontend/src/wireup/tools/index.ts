import { z } from 'zod';
import { ComponentRegistry } from '../../services/ComponentRegistry';
import { createComponentFromMetadata } from '../../components/DynamicComponent';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { useEditorStore } from '../../store/useEditorStore';
import { useElectricalStore } from '../../store/useElectricalStore';
import { isKnownBoardKind } from '../../types/board';
import { boardGateVerdict } from '../../lib/proBoardGate';
import { readPinInfo } from '../../utils/readPinInfo';
import { calculatePinPosition } from '../../utils/pinPositionCalculator';
import { autoWireColor, railWireColor } from '../../utils/wireUtils';
import { holeIsOccupied } from '../../utils/breadboardOccupancy';
import { isBreadboard } from '../../utils/breadboardNets';
import { captureProjectSnapshot, useWireupProject } from '../project';
import { getToolRuntime, isToolRuntimeBusy, type ToolResult } from './runtime';
import type { PropertyDescriptor } from '../../types/component-metadata';
import type { WireEndpoint } from '../../types/wire';

export type { ToolResult } from './runtime';
import { currentBuildResult, recordBuildOperation } from './buildResult';
const id = z.string().trim().min(1).max(256);
const position = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const empty = z.object({}).strict();
export const toolInputSchemas = {
  get_project_state: empty,
  get_build_result: empty,
  get_circuit: empty,
  search_components: z.object({ query: z.string().max(500) }).strict(),
  add_component: z.object({ component_type: id, position: position.optional() }).strict(),
  remove_component: z.object({ component_id: id }).strict(),
  set_component_property: z.object({ component_id: id, property: id, value: z.unknown() }).strict(),
  connect: z.object({ from_component: id, from_pin: id, to_component: id, to_pin: id }).strict(),
  disconnect: z.object({ wire_id: id }).strict(),
  update_connection: z.object({ wire_id: id, from_component: id, from_pin: id, to_component: id, to_pin: id }).strict(),
  get_firmware: empty,
  add_firmware_file: z.object({ name: id, content: z.string().max(2_000_000), group_id: id.optional() }).strict(),
  set_firmware: z.object({ file: id, content: z.string().max(2_000_000) }).strict(),
  compile_firmware: empty,
  start_simulation: empty,
  stop_simulation: empty,
  get_simulation_state: empty,
  get_serial_output: empty,
} as const;
export type WireupToolName = keyof typeof toolInputSchemas;

function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
async function result<T>(action: () => T | Promise<T>): Promise<ToolResult<T>> {
  try { return { success: true, data: jsonCopy(await action()) }; }
  catch (error) {
    return { success: false, error: error instanceof z.ZodError
      ? error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')
      : error instanceof Error ? error.message : String(error) };
  }
}
function ensureEditable() {
  const state = useSimulatorStore.getState();
  if (state.running || state.boards.some(board => board.running)) {
    throw new Error('Stop all simulations before modifying the project.');
  }
  if (isToolRuntimeBusy()) throw new Error('Wait for the current build or simulation start to finish.');
}
async function registry() {
  const catalog = ComponentRegistry.getInstance();
  await catalog.load();
  if (!catalog.isLoaded) throw new Error('Component metadata could not be loaded.');
  return catalog;
}
function partById(componentId: string) {
  const state = useSimulatorStore.getState();
  const component = state.components.find(part => part.id === componentId);
  const board = state.boards.find(part => part.id === componentId);
  if (!component && !board) throw new Error(`Component ${componentId} does not exist.`);
  return { component, board, part: component ?? board! };
}
async function mountedPins(componentId: string) {
  const deadline = Date.now() + 2_000;
  while (true) {
    const pins = readPinInfo(document.getElementById(componentId));
    if (pins) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const ready = readPinInfo(document.getElementById(componentId));
      if (ready) return { pins_available: true, pins: ready.map(pin => ({ name: pin.name })) };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Component ${componentId} was created but is unmounted or its pin info is unavailable after 2 seconds. Open the circuit editor and retry get_project_state(); do not add it again.`);
    await new Promise(resolve => setTimeout(resolve, Math.min(25, remaining)));
  }
}
function endpoint(componentId: string, pinName: string, ignoredWireId?: string): WireEndpoint {
  const { component, part } = partById(componentId);
  const pins = readPinInfo(document.getElementById(componentId));
  if (!pins) throw new Error(`Component ${componentId} is not mounted. Open the circuit editor and retry.`);
  if (!pins.some(pin => pin.name === pinName)) throw new Error(`Pin ${componentId}.${pinName} does not exist. Use an exact pin name from get_project_state().`);
  if (component && isBreadboard(component.metadataId) && holeIsOccupied(useSimulatorStore.getState().wires.filter(wire => wire.id !== ignoredWireId), componentId, pinName)) {
    throw new Error(`Breadboard hole ${componentId}.${pinName} is occupied. Choose a free hole in the same group.`);
  }
  const coords = calculatePinPosition(componentId, pinName, part.x + (component ? 6 : 0), part.y + (component ? 6 : 0), component ? Number(component.properties.rotation) || 0 : 0);
  if (!coords || !Number.isFinite(coords.x) || !Number.isFinite(coords.y)) throw new Error('Pin coordinates are unavailable. No wire was added.');
  return { componentId, pinName, ...coords };
}
function checkProperty(descriptor: PropertyDescriptor, value: unknown) {
  if (descriptor.options && (typeof value !== 'string' || !descriptor.options.includes(value))) throw new Error('Property value is not one of the allowed options.');
  if (descriptor.type === 'number' || descriptor.control === 'range' || typeof descriptor.defaultValue === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Property value must be a finite number.');
    if (descriptor.min !== undefined && value < descriptor.min) throw new Error(`Property minimum is ${descriptor.min}.`);
    if (descriptor.max !== undefined && value > descriptor.max) throw new Error(`Property maximum is ${descriptor.max}.`);
  } else if (descriptor.type === 'boolean' || descriptor.control === 'boolean' || typeof descriptor.defaultValue === 'boolean') {
    if (typeof value !== 'boolean') throw new Error('Property value must be a boolean.');
  } else {
    if (typeof value !== 'string' || value.length > 2_000_000) throw new Error('Property value must be a string within the size limit.');
    if (descriptor.type === 'select' && !descriptor.options?.includes(value)) throw new Error('Property value is not one of the allowed options.');
    if (descriptor.type === 'color' || descriptor.control === 'color') {
      const style = document.createElement('span').style;
      style.color = value;
      if (!style.color || /^(inherit|initial|unset|revert|currentcolor)$/i.test(value)) throw new Error('Property value must be a valid explicit CSS color.');
    }
  }
}

export async function get_project_state() {
  return result(() => {
    const state = useSimulatorStore.getState();
    const session = useWireupProject.getState();
    return {
      project: session.project ? { id: session.project.id, name: session.project.name, description: session.project.description } : null,
      dirty: session.dirty, saving: session.saving, snapshot: captureProjectSnapshot(),
      parts: [...state.boards.map(board => ({ id: board.id, component_type: board.boardKind })), ...state.components.map(part => ({ id: part.id, component_type: part.metadataId }))].map(part => {
        const pins = readPinInfo(document.getElementById(part.id));
        return { ...part, pins_available: pins !== undefined, pins: (pins ?? []).map(pin => ({ name: pin.name })) };
      }),
    };
  });
}
export const get_circuit = get_project_state;

export async function search_components(query: string) {
  return result(async () => {
    const input = toolInputSchemas.search_components.parse({ query });
    return { components: (await registry()).search(input.query).map(part => ({ component_type: part.id, name: part.name, category: part.category, description: part.description ?? '', properties: part.properties, pin_count: part.pinCount })) };
  });
}
export async function add_component(component_type: string, at?: { x: number; y: number }) {
  return result(async () => {
    const input = toolInputSchemas.add_component.parse({ component_type, position: at });
    ensureEditable();
    const catalog = await registry();
    ensureEditable();
    const metadata = catalog.getById(input.component_type);
    if (!metadata && !isKnownBoardKind(input.component_type)) throw new Error(`Unknown component type: ${input.component_type}.`);
    if (metadata?.pro_only) throw new Error('This component requires the existing licensed component workflow.');
    const state = useSimulatorStore.getState();
    const index = state.boards.length + state.components.length;
    const point = input.position ?? { x: 120 + (index % 3) * 220, y: 100 + Math.floor(index / 3) * 160 };
    const kind = metadata?.id ?? input.component_type;
    if (isKnownBoardKind(kind)) {
      const gate = boardGateVerdict(kind, 'add');
      if (gate.decision === 'block') throw new Error(gate.description ?? 'Board placement is not permitted.');
      const boardId = state.addBoard(kind, point.x, point.y);
      const board = useSimulatorStore.getState().boards.find(board => board.id === boardId);
      if (!board) throw new Error('Board placement was refused.');
      return { component_id: boardId, component_type: kind, position: point, ...await mountedPins(boardId) };
    }
    if (metadata!.category === 'boards') throw new Error('This board has no registered board implementation.');
    const component = createComponentFromMetadata(metadata!, point.x, point.y);
    state.recordAddComponent(component);
    return { component_id: component.id, component_type: component.metadataId, position: point, ...await mountedPins(component.id) };
  });
}
export async function remove_component(component_id: string) {
  return result(() => {
    const input = toolInputSchemas.remove_component.parse({ component_id });
    ensureEditable();
    const { board } = partById(input.component_id);
    const state = useSimulatorStore.getState();
    const removedWires = state.wires.filter(wire => wire.start.componentId === input.component_id || wire.end.componentId === input.component_id).map(wire => wire.id);
    if (board) state.removeBoard(board.id);
    else state.recordRemoveComponent(input.component_id);
    return { component_id: input.component_id, removed_wire_ids: removedWires };
  });
}
export async function set_component_property(component_id: string, property: string, value: unknown) {
  return result(async () => {
    const input = toolInputSchemas.set_component_property.parse({ component_id, property, value });
    if (['__proto__', 'constructor', 'prototype'].includes(input.property)) throw new Error('Invalid property name.');
    ensureEditable();
    const catalog = await registry();
    ensureEditable();
    const { component } = partById(input.component_id);
    if (!component) throw new Error('Board settings are not component properties. This tool only edits library component properties.');
    const descriptor = catalog.getById(component.metadataId)?.properties.find(prop => prop.name === input.property);
    if (input.property === 'rotation') {
      if (typeof value !== 'number' || ![0, 90, 180, 270].includes(value)) throw new Error('Rotation must be 0, 90, 180, or 270.');
    } else {
      if (!descriptor) throw new Error(`Unknown property ${input.property} for ${component.metadataId}.`);
      checkProperty(descriptor, input.value);
    }
    const previous = component.properties[input.property];
    const state = useSimulatorStore.getState();
    state.updateComponent(component.id, { properties: { ...component.properties, [input.property]: input.value } });
    if (input.property === 'rotation') state.recordRotate(component.id, Number(previous) || 0, value as number);
    else state.recordSetProperty(component.id, input.property, previous, input.value);
    return { component_id: component.id, property: input.property, value: input.value };
  });
}
function connectionEndpoints(input: { from_component: string; from_pin: string; to_component: string; to_pin: string }, ignoredWireId?: string) {
  const state = useSimulatorStore.getState();
  if (state.wireInProgress) throw new Error('Finish or cancel the current wire before connecting pins.');
  if (input.from_component === input.to_component && input.from_pin === input.to_pin) throw new Error('A pin cannot be connected to itself.');
  const matches = (end: WireEndpoint, cid: string, pin: string) => end.componentId === cid && end.pinName === pin;
  if (state.wires.some(wire => wire.id !== ignoredWireId && ((matches(wire.start, input.from_component, input.from_pin) && matches(wire.end, input.to_component, input.to_pin)) || (matches(wire.end, input.from_component, input.from_pin) && matches(wire.start, input.to_component, input.to_pin))))) throw new Error('These pins are already connected.');
  return { start: endpoint(input.from_component, input.from_pin, ignoredWireId), end: endpoint(input.to_component, input.to_pin, ignoredWireId) };
}
function createRoutedWire(start: WireEndpoint, end: WireEndpoint, color = railWireColor(start.pinName) ?? railWireColor(end.pinName) ?? autoWireColor(start.pinName)) {
  const state = useSimulatorStore.getState();
  const previousIds = new Set(state.wires.map(wire => wire.id));
  try {
    state.startWireCreation(start, color);
    state.finishWireCreation(end);
    const created = useSimulatorStore.getState().wires.at(-1);
    if (!created || previousIds.has(created.id) || created.start !== start || created.end !== end) throw new Error('The existing wire creation operation did not create a wire.');
    return created;
  } catch (error) {
    state.cancelWireCreation();
    for (const wire of useSimulatorStore.getState().wires) {
      if (!previousIds.has(wire.id)) state.removeWire(wire.id);
    }
    throw error;
  }
}
export async function connect(from_component: string, from_pin: string, to_component: string, to_pin: string) {
  return result(() => {
    const input = toolInputSchemas.connect.parse({ from_component, from_pin, to_component, to_pin });
    ensureEditable();
    const { start, end } = connectionEndpoints(input);
    const created = createRoutedWire(start, end);
    useSimulatorStore.getState().pushCommand({ description: 'Add wire', execute: () => useSimulatorStore.getState().addWire(created), undo: () => useSimulatorStore.getState().removeWire(created.id) }, { applyNow: false });
    return { wire: created };
  });
}
export async function update_connection(wire_id: string, from_component: string, from_pin: string, to_component: string, to_pin: string) {
  return result(() => {
    const input = toolInputSchemas.update_connection.parse({ wire_id, from_component, from_pin, to_component, to_pin });
    ensureEditable();
    const state = useSimulatorStore.getState();
    const previous = state.wires.find(wire => wire.id === input.wire_id);
    if (!previous) throw new Error(`Wire ${input.wire_id} does not exist.`);
    if (previous.bb) throw new Error('Breadboard seating wires are managed by component placement and cannot be updated directly.');
    const { start, end } = connectionEndpoints(input, previous.id);
    const selectedWireId = state.selectedWireId;
    state.removeWire(previous.id);
    let routed;
    try {
      routed = createRoutedWire(start, end, previous.color);
      state.removeWire(routed.id);
    } finally {
      // Restore the transaction baseline without clearing canvas history.
      useSimulatorStore.setState({ wires: state.wires, selectedWireId });
    }
    const updated = { ...previous, ...routed, id: previous.id };
    state.recordUpdateWire(previous.id, previous, updated, 'Update connection');
    return { wire: updated };
  });
}
export async function disconnect(wire_id: string) {
  return result(() => {
    const input = toolInputSchemas.disconnect.parse({ wire_id });
    ensureEditable();
    const state = useSimulatorStore.getState();
    const wire = state.wires.find(wire => wire.id === input.wire_id);
    if (!wire) throw new Error(`Wire ${input.wire_id} does not exist.`);
    if (wire.bb) throw new Error('Breadboard seating wires are managed by component placement and cannot be disconnected directly.');
    state.recordRemoveWire(input.wire_id);
    return { wire_id: input.wire_id };
  });
}
export async function get_firmware() {
  return result(() => {
    const state = useEditorStore.getState();
    return { active_group_id: state.activeGroupId, files: Object.keys(state.fileGroups).flatMap(group => state.getGroupFiles(group).map(file => ({ file: file.id, name: file.name, group_id: group, content: file.content }))) };
  });
}
function firmwarePath(name: string) {
  const path = name.replace(/\\/g, '/');
  if (path.startsWith('/') || /[<>:"|?*\u0000-\u001f\u007f]/.test(path) || path.split('/').some(segment => !segment || segment === '.' || segment === '..' || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) {
    throw new Error('Firmware name must be a safe relative path without absolute paths, traversal, or forbidden characters.');
  }
  return path;
}
export async function add_firmware_file(name: string, content: string, group_id?: string) {
  return result(() => {
    const input = toolInputSchemas.add_firmware_file.parse({ name, content, group_id });
    ensureEditable();
    const path = firmwarePath(input.name);
    const state = useEditorStore.getState();
    const group = input.group_id ?? state.activeGroupId;
    if (!Object.hasOwn(state.fileGroups, group)) throw new Error(`Firmware group ${group} does not exist.`);
    if (state.getGroupFiles(group).some(file => file.name.replace(/\\/g, '/').toLowerCase() === path.toLowerCase())) throw new Error('Firmware file already exists. Use set_firmware to update it.');
    state.addFileToGroup(group, { name: path, content: input.content });
    const created = useEditorStore.getState().getGroupFiles(group).find(file => file.name === path);
    if (!created) throw new Error('The existing editor operation did not create a firmware file.');
    useEditorStore.setState({ codeChangedSinceLastCompile: true });
    return { file: created.id, name: created.name, group_id: group, content: created.content };
  });
}
export async function set_firmware(file: string, content: string) {
  return result(() => {
    const input = toolInputSchemas.set_firmware.parse({ file, content });
    ensureEditable();
    const state = useEditorStore.getState();
    const all = Object.keys(state.fileGroups).flatMap(group => state.getGroupFiles(group).map(file => ({ group, file })));
    const byId = all.filter(item => item.file.id === input.file);
    const candidates = byId.length ? byId : all.filter(item => item.file.name === input.file);
    if (!candidates.length) throw new Error('Firmware file does not exist. This tool updates existing files only.');
    if (candidates.length !== 1) throw new Error('Firmware filename is ambiguous. Use the file ID returned by get_firmware().');
    const target = candidates[0];
    if (target.group === state.activeGroupId) state.setFileContent(target.file.id, input.content);
    else {
      state.updateGroupFile(target.group, target.file.id, input.content);
      // Preserve the editor's existing global invalidation for inactive groups.
      useEditorStore.setState({ codeChangedSinceLastCompile: true });
    }
    return { file: target.file.id, name: target.file.name, group_id: target.group, content: input.content };
  });
}
export async function get_build_result() { return result(() => currentBuildResult()); }
export async function compile_firmware(): Promise<ToolResult> {
  try { const outcome = jsonCopy(await getToolRuntime().compile()); recordBuildOperation('compile', outcome); return outcome; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}
export async function start_simulation(): Promise<ToolResult> {
  try { const outcome = jsonCopy(await getToolRuntime().start()); recordBuildOperation('simulation', outcome); return outcome; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}
export async function stop_simulation(): Promise<ToolResult> {
  try { return jsonCopy(await getToolRuntime().stop()); }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}
export async function get_simulation_state() {
  return result(() => {
    const state = useSimulatorStore.getState();
    return { active_board_id: state.activeBoardId, running: state.running || state.boards.some(board => board.running), electrical_paused: useElectricalStore.getState().paused, electrical: { converged: useElectricalStore.getState().converged, error: useElectricalStore.getState().error, last_solve_ms: useElectricalStore.getState().lastSolveMs }, busy: isToolRuntimeBusy(), boards: state.boards.map(board => ({ component_id: board.id, component_type: board.boardKind, running: board.running, program_loaded: Boolean(board.compiledProgram), pi_booted: board.piBooted ?? null, engine: board.engineMode ?? null })) };
  });
}
export async function get_serial_output() {
  return result(() => {
    const state = useSimulatorStore.getState();
    return { active_board_id: state.activeBoardId, output: state.serialOutput, format: 'monitor_text', boards: state.boards.map(board => ({ component_id: board.id, output: board.serialOutput, baud_rate: board.serialBaudRate })) };
  });
}

/** JSON entry point for future AI/MCP integration; it exposes no store handles. */
export async function executeWireupTool(name: string, args: unknown = {}): Promise<ToolResult> {
  if (!Object.hasOwn(toolInputSchemas, name)) return { success: false, error: `Unknown Wireup tool: ${name}.` };
  try {
    const tool = name as WireupToolName;
    const input = toolInputSchemas[tool].parse(args);
    switch (tool) {
      case 'search_components': return search_components((input as { query: string }).query);
      case 'add_component': { const arg = input as { component_type: string; position?: { x: number; y: number } }; return add_component(arg.component_type, arg.position); }
      case 'remove_component': return remove_component((input as { component_id: string }).component_id);
      case 'set_component_property': { const arg = input as { component_id: string; property: string; value: unknown }; if (!Object.hasOwn(arg, 'value')) throw new Error('Property value is required.'); return set_component_property(arg.component_id, arg.property, arg.value); }
      case 'connect': { const arg = input as { from_component: string; from_pin: string; to_component: string; to_pin: string }; return connect(arg.from_component, arg.from_pin, arg.to_component, arg.to_pin); }
      case 'disconnect': return disconnect((input as { wire_id: string }).wire_id);
      case 'update_connection': { const arg = input as { wire_id: string; from_component: string; from_pin: string; to_component: string; to_pin: string }; return update_connection(arg.wire_id, arg.from_component, arg.from_pin, arg.to_component, arg.to_pin); }
      case 'add_firmware_file': { const arg = input as { name: string; content: string; group_id?: string }; return add_firmware_file(arg.name, arg.content, arg.group_id); }
      case 'set_firmware': { const arg = input as { file: string; content: string }; return set_firmware(arg.file, arg.content); }
      case 'get_project_state': return get_project_state();
      case 'get_build_result': return get_build_result();
      case 'get_circuit': return get_circuit();
      case 'get_firmware': return get_firmware();
      case 'compile_firmware': return compile_firmware();
      case 'start_simulation': return start_simulation();
      case 'stop_simulation': return stop_simulation();
      case 'get_simulation_state': return get_simulation_state();
      case 'get_serial_output': return get_serial_output();
    }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}
