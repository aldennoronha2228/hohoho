import JSZip from 'jszip';
import { BOARD_KIND_LABELS } from '../types/board';
import type { BoardKind } from '../types/board';
import type { ProjectSnapshot } from './project';

export interface BomRow {
  kind: string;
  label: string;
  specification: string;
  quantity: number;
  references: string[];
}
export interface ConnectionRow {
  id: string;
  from: string;
  to: string;
  color: string;
  signal: string;
  seated: boolean;
}
export interface PrototypeModel {
  bom: BomRow[];
  connections: ConnectionRow[];
  instructions: string[];
  warnings: string[];
  sourceCount: number;
}
const title = (kind: string) => kind.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const specKeys = ['value', 'resistance', 'capacitance', 'inductance', 'color', 'voltage', 'model', 'chipType', 'partNumber', 'protocol', 'address'];
export function buildPrototypeModel(snapshot: ProjectSnapshot): PrototypeModel {
  const { circuit } = snapshot;
  const grouped = new Map<string, BomRow>();
  const add = (kind: string, label: string, specification: string, id: string) => {
    const key = JSON.stringify([kind, specification]);
    const existing = grouped.get(key);
    if (existing) { existing.quantity++; existing.references.push(id); }
    else grouped.set(key, { kind, label, specification, quantity: 1, references: [id] });
  };
  for (const board of circuit.boards) add(board.boardKind, BOARD_KIND_LABELS[board.boardKind as BoardKind] ?? title(board.boardKind), '', board.id);
  const virtual = new Set(['junction', 'instr-voltmeter', 'instr-ammeter', 'logic-analyzer', 'oscilloscope']);
  for (const part of circuit.components) {
    if (virtual.has(part.metadataId)) continue;
    const properties = part.properties ?? {};
    const specification = specKeys.filter((key) => properties[key] !== undefined).map((key) => `${key}: ${String(properties[key])}`).join('; ');
    add(part.metadataId, title(part.metadataId), specification, part.id);
  }
  const connections = circuit.wires.map((wire) => ({
    id: wire.id, from: `${wire.start.componentId}.${wire.start.pinName}`, to: `${wire.end.componentId}.${wire.end.pinName}`,
    color: wire.color, signal: wire.signalType ?? 'unclassified', seated: wire.bb === true,
  }));
  const jumpers = connections.filter((connection) => !connection.seated && !circuit.wires.find((wire) => wire.id === connection.id && (virtual.has(circuit.components.find((part) => part.id === wire.start.componentId)?.metadataId ?? '') || virtual.has(circuit.components.find((part) => part.id === wire.end.componentId)?.metadataId ?? ''))));
  if (jumpers.length) add('jumper-wire', 'Jumper wires', 'Length and connector type: choose for your physical layout', '');
  const jumperRow = grouped.get(JSON.stringify(['jumper-wire', 'Length and connector type: choose for your physical layout']));
  if (jumperRow) { jumperRow.quantity = jumpers.length; jumperRow.references = jumpers.map((wire) => wire.id); }
  const instructions = [
    'Disconnect USB and all external power before assembling the circuit.',
    ...[...grouped.values()].filter((row) => row.kind !== 'jumper-wire').map((row) => `Place ${row.quantity} × ${row.label}${row.specification ? ` (${row.specification})` : ''}: ${row.references.join(', ')}.`),
    ...connections.map((wire) => `${wire.seated ? 'Seat' : 'Connect'} ${wire.from} → ${wire.to}${wire.seated ? ' in the indicated breadboard hole' : ` using ${wire.color} wire`}${wire.signal !== 'unclassified' ? ` (${wire.signal})` : ''}.`),
    ...circuit.boards.map((board) => `Build and upload the sources in ${board.activeFileGroupId} to ${board.id}${board.libraries?.length ? `; install libraries: ${board.libraries.join(', ')}` : ''}.`),
    'Check continuity, polarity, supply voltage and component ratings against hardware datasheets before applying power.',
  ];
  const warnings = ['This is a connection guide, not a certified electrical safety check. Canvas distances do not determine wire lengths.'];
  if (circuit.components.some((part) => virtual.has(part.metadataId))) warnings.push('Virtual junctions and instruments are excluded from the physical BOM. Their connections remain in the wiring list; implement junctions as real electrical nodes.');
  if (connections.some((wire) => wire.signal === 'unclassified')) warnings.push('Some wires have no signal classification. Verify their purpose before powering the circuit.');
  if (circuit.components.some((part) => part.metadataId === 'custom-chip')) warnings.push('Custom chips may represent simulated behavior rather than purchasable hardware. Confirm a real part and pinout.');
  return { bom: [...grouped.values()], connections, instructions, warnings, sourceCount: Object.values(snapshot.editor.fileGroups).reduce((count, files) => count + files.length, 0) };
}

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  // Neutralize spreadsheet formulas while preserving quoted CSV syntax.
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
};
export function prototypeCsv(model: PrototypeModel, section: 'bom' | 'wires'): string {
  const rows = section === 'bom'
    ? [['Part', 'Specification', 'Quantity', 'References'], ...model.bom.map((row) => [row.label, row.specification, row.quantity, row.references.join('; ')])]
    : [['Wire', 'From', 'To', 'Color', 'Signal', 'Breadboard seating'], ...model.connections.map((row) => [row.id, row.from, row.to, row.color, row.signal, row.seated])];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
const safePath = (path: string) => {
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..') || /^[a-z]:/i.test(path)) throw new Error(`Unsafe archive path: ${path}`);
  return parts.join('/');
};
export async function buildSourceArchive(snapshot: ProjectSnapshot): Promise<Blob> {
  const zip = new JSZip();
  for (const [group, files] of Object.entries(snapshot.editor.fileGroups)) {
    for (const file of files) zip.file(`sources/${safePath(group)}/${safePath(file.name)}`, file.content);
    for (const folder of snapshot.editor.folderGroups[group] ?? []) zip.folder(`sources/${safePath(group)}/${safePath(folder)}`);
  }
  for (const board of snapshot.circuit.boards) {
    if (board.libraries?.length) zip.file(`sources/${safePath(board.activeFileGroupId)}/wireup-libraries.json`, JSON.stringify(board.libraries, null, 2));
    for (const [kind, files] of [['sd', board.sdFiles], ['spiffs', board.spiffsFiles]] as const) {
      for (const file of files ?? []) zip.file(`uploads/${safePath(board.id)}/${kind}/${safePath(file.name)}`, file.contentB64, { base64: true });
    }
  }
  for (const [boardId, { tree }] of Object.entries(snapshot.vfs.boards)) {
    for (const node of Object.values(tree)) {
      if (node.type !== 'file') continue;
      const parts = [node.name];
      let parent = node.parentId;
      while (parent && tree[parent]?.parentId !== null) { parts.unshift(tree[parent].name); parent = tree[parent].parentId; }
      zip.file(`vfs/${safePath(boardId)}/${safePath(parts.join('/'))}`, node.content ?? '');
    }
  }
  zip.file('circuit.json', JSON.stringify(snapshot.circuit, null, 2));
  return zip.generateAsync({ type: 'blob' });
}
