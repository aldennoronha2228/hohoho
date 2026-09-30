import type { BoardInstance } from '../types/board';
import type { Wire, WireEndpoint } from '../types/wire';
import { breadboardGroupKey } from '../utils/breadboardNets';

export interface SchematicComponent {
  id: string;
  metadataId: string;
  properties?: Record<string, unknown>;
}
export interface SchematicPoint { x: number; y: number }
export interface SchematicPin extends SchematicPoint {
  name: string;
  key: string;
  side: 'left' | 'right';
  connections: number;
}
export interface SchematicPart extends SchematicPoint {
  id: string;
  kind: string;
  label: string;
  specification: string;
  board: boolean;
  width: number;
  height: number;
  row: number;
  column: number;
  pins: SchematicPin[];
}
export interface SchematicNet {
  id: string;
  endpoints: Array<{ componentId: string; pinName: string }>;
  wireIds: string[];
}
export interface SchematicRoute {
  wire: Wire;
  netId: string;
  points: SchematicPoint[];
}
export interface SchematicModel {
  parts: SchematicPart[];
  routes: SchematicRoute[];
  nets: SchematicNet[];
  unresolved: Wire[];
  bounds: { x: number; y: number; width: number; height: number };
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const pinKey = (endpoint: Pick<WireEndpoint, 'componentId' | 'pinName'>) => JSON.stringify([endpoint.componentId, endpoint.pinName]);
const specificationKeys = ['value', 'resistance', 'capacitance', 'inductance', 'model', 'chipName', 'partNumber', 'protocol', 'address'];
const fallbackLabel = (kind: string) => kind.replace(/[-_]/g, ' ');

/** Nets describe wire connectivity and registered internal groups, not electrical validation. */
export function buildSchematicModel(
  boards: ReadonlyArray<Pick<BoardInstance, 'id' | 'boardKind' | 'name'>>,
  components: ReadonlyArray<SchematicComponent>,
  wires: ReadonlyArray<Wire>,
  labelFor: (kind: string) => string | undefined = () => undefined,
): SchematicModel {
  const seeds = [
    ...boards.map((board) => ({ id: board.id, kind: board.boardKind as string, label: board.name?.trim() || labelFor(board.boardKind) || fallbackLabel(board.boardKind), specification: '', board: true })),
    ...components.map((part) => ({ id: part.id, kind: part.metadataId, label: labelFor(part.metadataId) || fallbackLabel(part.metadataId), specification: specificationKeys.filter((key) => part.properties?.[key] !== undefined).map((key) => `${key}: ${String(part.properties?.[key])}`).join(' · '), board: false })),
  ].sort((a, b) => Number(b.board) - Number(a.board) || compare(a.id, b.id));
  const seedsById = new Map(seeds.map((part) => [part.id, part]));
  const orderedWires = [...wires].sort((a, b) => compare(a.id, b.id));
  const unresolved = orderedWires.filter((wire) => !seedsById.has(wire.start.componentId) || !seedsById.has(wire.end.componentId));
  const validWires = orderedWires.filter((wire) => seedsById.has(wire.start.componentId) && seedsById.has(wire.end.componentId));
  const neighbors = new Map(seeds.map((part) => [part.id, new Set<string>()]));
  const endpoints = new Map<string, Pick<WireEndpoint, 'componentId' | 'pinName'>>();
  const degree = new Map<string, number>();
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (key !== root) { const next = parent.get(key)!; parent.set(key, root); key = next; }
    return root;
  };
  const union = (a: string, b: string) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  for (const wire of validWires) {
    neighbors.get(wire.start.componentId)!.add(wire.end.componentId);
    neighbors.get(wire.end.componentId)!.add(wire.start.componentId);
    for (const endpoint of [wire.start, wire.end]) {
      const key = pinKey(endpoint);
      endpoints.set(key, { componentId: endpoint.componentId, pinName: endpoint.pinName });
      if (!parent.has(key)) parent.set(key, key);
      degree.set(key, (degree.get(key) ?? 0) + 1);
    }
    union(pinKey(wire.start), pinKey(wire.end));
  }
  const internalAnchors = new Map<string, string>();
  for (const [key, endpoint] of endpoints) {
    const kind = seedsById.get(endpoint.componentId)!.kind;
    const group = kind === 'junction' ? 'junction' : breadboardGroupKey(kind, endpoint.pinName);
    if (group === null) continue;
    const groupId = JSON.stringify([endpoint.componentId, group]);
    const anchor = internalAnchors.get(groupId);
    if (anchor) union(anchor, key); else internalAnchors.set(groupId, key);
  }
  const grouped = new Map<string, SchematicNet>();
  for (const [key, endpoint] of endpoints) {
    const root = find(key);
    const net = grouped.get(root) ?? { id: '', endpoints: [], wireIds: [] };
    net.endpoints.push(endpoint);
    grouped.set(root, net);
  }
  for (const wire of validWires) grouped.get(find(pinKey(wire.start)))!.wireIds.push(wire.id);
  const nets = [...grouped.values()];
  for (const net of nets) net.endpoints.sort((a, b) => compare(pinKey(a), pinKey(b)));
  nets.sort((a, b) => compare(pinKey(a.endpoints[0]), pinKey(b.endpoints[0])));
  const netByWire = new Map<string, string>();
  nets.forEach((net, index) => { net.id = `N${index + 1}`; for (const id of net.wireIds) netByWire.set(id, net.id); });

  // Traverse connected parts together, with boards as deterministic roots.
  const ordered: typeof seeds = [];
  const visited = new Set<string>();
  for (const seed of seeds) {
    if (visited.has(seed.id)) continue;
    const queue = [seed.id];
    visited.add(seed.id);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor];
      ordered.push(seedsById.get(id)!);
      for (const next of [...neighbors.get(id)!].sort(compare)) {
        if (!visited.has(next)) { visited.add(next); queue.push(next); }
      }
    }
  }
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(ordered.length))));
  const positions = new Map(ordered.map((part, index) => [part.id, { column: index % columns, row: Math.floor(index / columns) }]));
  const pinsByPart = new Map<string, Array<Pick<WireEndpoint, 'componentId' | 'pinName'>>>();
  for (const endpoint of endpoints.values()) {
    const pins = pinsByPart.get(endpoint.componentId) ?? [];
    pins.push(endpoint);
    pinsByPart.set(endpoint.componentId, pins);
  }
  const parts: SchematicPart[] = ordered.map((seed) => {
    const position = positions.get(seed.id)!;
    const pins = (pinsByPart.get(seed.id) ?? []).sort((a, b) => compare(a.pinName, b.pinName)).map((endpoint) => {
      const otherColumns: number[] = [];
      for (const wire of validWires) {
        if (pinKey(wire.start) === pinKey(endpoint)) otherColumns.push(positions.get(wire.end.componentId)!.column);
        if (pinKey(wire.end) === pinKey(endpoint)) otherColumns.push(positions.get(wire.start.componentId)!.column);
      }
      const towardRight = otherColumns.reduce((sum, column) => sum + column - position.column, 0) >= 0;
      return { name: endpoint.pinName, key: pinKey(endpoint), side: towardRight ? 'right' as const : 'left' as const, connections: degree.get(pinKey(endpoint)) ?? 0, x: 0, y: 0 };
    });
    const longestPin = Math.max(0, ...pins.map((pin) => pin.name.length));
    const width = Math.max(210, Math.min(440, Math.max(seed.label.length * 7 + 32, longestPin * 14 + 60)));
    const height = Math.max(104, 74 + Math.max(pins.filter((pin) => pin.side === 'left').length, pins.filter((pin) => pin.side === 'right').length) * 24);
    return { ...seed, ...position, x: 0, y: 0, width, height, pins };
  });
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(210, ...parts.filter((part) => part.column === column).map((part) => part.width)));
  const rowHeights = Array.from({ length: Math.ceil(parts.length / columns) }, (_, row) => Math.max(104, ...parts.filter((part) => part.row === row).map((part) => part.height)));
  const columnX = columnWidths.map((_, index) => 100 + columnWidths.slice(0, index).reduce((sum, width) => sum + width + 160, 0));
  const rowY = rowHeights.map((_, index) => 180 + rowHeights.slice(0, index).reduce((sum, height) => sum + height + 180, 0));
  const placedPins = new Map<string, SchematicPin>();
  for (const part of parts) {
    part.x = columnX[part.column];
    part.y = rowY[part.row];
    const counts = { left: 0, right: 0 };
    for (const pin of part.pins) {
      pin.x = part.x + (pin.side === 'right' ? part.width + 18 : -18);
      pin.y = part.y + 64 + counts[pin.side]++ * 24;
      placedPins.set(pin.key, pin);
    }
  }
  const partById = new Map(parts.map((part) => [part.id, part]));
  const routes = validWires.map((wire, index) => {
    const start = placedPins.get(pinKey(wire.start))!;
    const end = placedPins.get(pinKey(wire.end))!;
    const a = partById.get(wire.start.componentId)!;
    const b = partById.get(wire.end.componentId)!;
    const lane = index % 12;
    const gutter = (part: SchematicPart, pin: SchematicPin) => pin.side === 'left' ? columnX[part.column] - 38 - lane * 5 : columnX[part.column] + columnWidths[part.column] + 38 + lane * 5;
    const ax = gutter(a, start);
    const bx = gutter(b, end);
    const channelY = Math.min(a.y, b.y) - 34 - lane * 10;
    const facing = a.row === b.row && ((b.column === a.column + 1 && start.side === 'right' && end.side === 'left') || (a.column === b.column + 1 && end.side === 'right' && start.side === 'left'));
    const midX = (start.x + end.x) / 2 + (lane - 6) * 4;
    const points = facing
      ? [{ x: start.x, y: start.y }, { x: midX, y: start.y }, { x: midX, y: end.y }, { x: end.x, y: end.y }]
      : [{ x: start.x, y: start.y }, { x: ax, y: start.y }, { x: ax, y: channelY }, { x: bx, y: channelY }, { x: bx, y: end.y }, { x: end.x, y: end.y }];
    return { wire, netId: netByWire.get(wire.id)!, points };
  });
  const allPoints = [...parts.flatMap((part) => [{ x: part.x - 18, y: part.y }, { x: part.x + part.width + 18, y: part.y + part.height }]), ...routes.flatMap((route) => route.points)];
  const minX = Math.min(0, ...allPoints.map((point) => point.x)) - 30;
  const minY = Math.min(0, ...allPoints.map((point) => point.y)) - 30;
  const maxX = Math.max(400, ...allPoints.map((point) => point.x)) + 30;
  const maxY = Math.max(280, ...allPoints.map((point) => point.y)) + 30;
  return { parts, routes, nets, unresolved, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } };
}

export interface SchematicView { x: number; y: number; scale: number }
export function fitSchematic(bounds: SchematicModel['bounds'], width: number, height: number): SchematicView {
  const scale = Math.max(0.01, Math.min(1.3, (width - 56) / bounds.width, (height - 56) / bounds.height));
  return { scale, x: (width - bounds.width * scale) / 2 - bounds.x * scale, y: (height - bounds.height * scale) / 2 - bounds.y * scale };
}
export function zoomSchematic(view: SchematicView, factor: number, anchor: SchematicPoint): SchematicView {
  const scale = Math.max(0.01, Math.min(4, view.scale * factor));
  const ratio = scale / view.scale;
  return { scale, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio };
}
