import { captureProjectSnapshot, useWireupProject } from '../project';
import { buildPrototypeModel } from '../prototypeModel';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { ComponentRegistry } from '../../services/ComponentRegistry';
import { useElectricalStore } from '../../store/useElectricalStore';
import type { ToolResult } from './runtime';

function identity(): string {
  const snapshot = captureProjectSnapshot();
  return JSON.stringify({ project_id: useWireupProject.getState().project?.id ?? null, components: snapshot.circuit.components, wires: snapshot.circuit.wires, boards: snapshot.circuit.boards.map(board => ({ id: board.id, boardKind: board.boardKind, activeFileGroupId: board.activeFileGroupId, languageMode: board.languageMode, boardOptions: board.boardOptions, libraries: board.libraries })), files: Object.fromEntries(Object.entries(snapshot.editor.fileGroups).map(([group, files]) => [group, files.map(({ id, name, content }) => ({ id, name, content }))])) });
}
let compilation: { identity: string; result: ToolResult } | null = null;
let simulation: { identity: string; result: ToolResult } | null = null;

export function recordBuildOperation(kind: 'compile' | 'simulation', result: ToolResult): void {
  const record = { identity: identity(), result: JSON.parse(JSON.stringify(result)) as ToolResult };
  if (kind === 'compile') compilation = record;
  else simulation = record;
}

/** Reuses the existing build-pack derivation and real operation evidence. */
export function currentBuildResult() {
  const snapshot = captureProjectSnapshot();
  const model = buildPrototypeModel(snapshot);
  const current = identity();
  const state = useSimulatorStore.getState();
  const registry = ComponentRegistry.getInstance();
  return {
    project_overview: { name: useWireupProject.getState().project?.name ?? 'Current workspace', description: useWireupProject.getState().project?.description ?? '', board_count: snapshot.circuit.boards.length },
    components: model.bom.map(row => ({ component: row.label, component_type: row.kind, quantity: row.quantity, purpose: registry.getById(row.kind)?.description ?? (row.kind === 'jumper-wire' ? 'Connect the listed circuit pins.' : 'Use this part according to its board/component datasheet.'), specification: row.specification, references: row.references })),
    wiring: model.connections,
    firmware: Object.entries(snapshot.editor.fileGroups).flatMap(([group_id, files]) => files.map(file => ({ group_id, file: file.id, name: file.name, content: file.content }))),
    build_instructions: model.instructions.map((instruction, index) => ({ step: index + 1, instruction })),
    compilation_result: compilation?.identity === current ? compilation.result : { success: false, error: 'No tool compilation result is available for the current project revision.' },
    simulation_result: { electrical: { converged: useElectricalStore.getState().converged, error: useElectricalStore.getState().error, last_solve_ms: useElectricalStore.getState().lastSolveMs }, last_start: simulation?.identity === current ? simulation.result : { success: false, error: 'No tool simulation-start result is available for the current project revision.' }, running: state.running || state.boards.some(board => board.running), boards: state.boards.map(board => ({ component_id: board.id, running: board.running, program_loaded: Boolean(board.compiledProgram), pi_booted: board.piBooted ?? null })), serial_output: state.boards.map(board => ({ component_id: board.id, output: board.serialOutput })) },
    warnings: model.warnings,
    physical_hardware_verified: false,
  };
}
