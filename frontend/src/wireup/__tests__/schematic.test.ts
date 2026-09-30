import { describe, expect, it } from 'vitest';
import type { Wire } from '../../types/wire';
import { buildSchematicModel, fitSchematic, zoomSchematic } from '../schematicModel';

const board = { id: 'uno', boardKind: 'arduino-uno' as const, name: 'Bench controller' };
const part = (id: string, metadataId = 'led') => ({ id, metadataId, properties: {} });
const wire = (id: string, from: string, fromPin: string, to: string, toPin: string, extra: Partial<Wire> = {}): Wire => ({
  id, start: { componentId: from, pinName: fromPin, x: 99, y: 77 },
  end: { componentId: to, pinName: toPin, x: 444, y: 888 }, color: '#e8c453', waypoints: [], ...extra,
});

describe('Circuit-derived schematic', () => {
  it('has no invented parts, pins, wires, or nets in an empty workspace', () => {
    const model = buildSchematicModel([], [], []);
    expect(model.parts).toEqual([]);
    expect(model.routes).toEqual([]);
    expect(model.nets).toEqual([]);
    expect(Number.isFinite(fitSchematic(model.bounds, 320, 240).scale)).toBe(true);
  });
  it('uses actual board kinds, metadata labels, custom names and endpoint pin names', () => {
    const wires = [wire('w1', 'uno', '13', 'led', 'A')];
    const model = buildSchematicModel([board], [part('led')], wires, (kind) => kind === 'led' ? 'Light-emitting diode' : undefined);
    expect(model.parts.find((item) => item.id === 'uno')).toMatchObject({ kind: 'arduino-uno', label: 'Bench controller' });
    expect(model.parts.find((item) => item.id === 'led')?.label).toBe('Light-emitting diode');
    expect(model.parts.flatMap((item) => item.pins.map((pin) => pin.name)).sort()).toEqual(['13', 'A']);
    expect(model.routes[0].wire).toBe(wires[0]);
    expect(model.routes[0].points[0]).not.toEqual({ x: 99, y: 77 });
  });
  it('renders unwired real parts without making up pinouts', () => {
    const model = buildSchematicModel([board], [part('sensor', 'unknown-module')], []);
    expect(model.parts).toHaveLength(2);
    expect(model.parts.every((item) => item.pins.length === 0)).toBe(true);
    expect(model.nets).toHaveLength(0);
  });
  it('merges shared endpoints, but never connects through a resistor body or geometric crossings', () => {
    const model = buildSchematicModel([board], [part('r', 'resistor'), part('led')], [
      wire('w1', 'uno', '13', 'r', '1'), wire('w2', 'r', '2', 'led', 'A'), wire('w3', 'uno', '13', 'led', 'C'),
    ]);
    expect(model.nets).toHaveLength(2);
    expect(model.nets.find((net) => net.wireIds.includes('w1'))?.wireIds).toEqual(['w1', 'w3']);
    expect(model.parts.find((item) => item.id === 'uno')?.pins[0].connections).toBe(2);
  });
  it('includes breadboard seating and known internal strips in connected nets', () => {
    const model = buildSchematicModel([board], [part('bb', 'breadboard'), part('led')], [
      wire('w1', 'uno', '13', 'bb', '18t.a'), wire('w2', 'led', 'A', 'bb', '18t.e', { bb: true }),
      wire('w3', 'led', 'C', 'bb', '18b.f'),
    ]);
    expect(model.routes).toHaveLength(3);
    expect(model.routes.find((route) => route.wire.id === 'w2')?.wire.bb).toBe(true);
    expect(model.nets).toHaveLength(2);
    expect(model.nets.find((net) => net.wireIds.includes('w1'))?.wireIds).toEqual(['w1', 'w2']);
  });
  it('merges virtual junction pins without fabricating additional wire records', () => {
    const model = buildSchematicModel([board], [part('j', 'junction'), part('led')], [
      wire('w1', 'uno', '13', 'j', 'A'), wire('w2', 'j', 'B', 'led', 'A'),
    ]);
    expect(model.nets).toHaveLength(1);
    expect(model.routes).toHaveLength(2);
  });
  it('reports missing endpoints without drawing invented parts or partial wires', () => {
    const broken = wire('broken', 'uno', '13', 'missing', 'GND');
    const model = buildSchematicModel([board], [], [broken]);
    expect(model.unresolved).toEqual([broken]);
    expect(model.routes).toEqual([]);
    expect(model.nets).toEqual([]);
    expect(model.parts).toHaveLength(1);
  });
  it('produces deterministic layouts independent of input order, with orthogonal exact endpoints', () => {
    const parts = [part('z'), part('a'), part('r', 'resistor')];
    const wires = [wire('w2', 'r', '2', 'z', 'C'), wire('w1', 'uno', '13', 'a', 'A'), wire('w3', 'a', 'C', 'r', '1')];
    const model = buildSchematicModel([board], parts, wires);
    expect(buildSchematicModel([board], [...parts].reverse(), [...wires].reverse())).toEqual(model);
    for (const route of model.routes) {
      for (let i = 1; i < route.points.length; i++) expect(route.points[i].x === route.points[i - 1].x || route.points[i].y === route.points[i - 1].y).toBe(true);
      for (const [endpoint, point] of [[route.wire.start, route.points[0]], [route.wire.end, route.points.at(-1)!]] as const) {
        const pin = model.parts.find((item) => item.id === endpoint.componentId)!.pins.find((item) => item.name === endpoint.pinName)!;
        expect(point).toEqual({ x: pin.x, y: pin.y });
      }
    }
  });
  it('keeps many parts non-overlapping and does not route through symbol interiors', () => {
    const parts = Array.from({ length: 80 }, (_, index) => part(`p${String(index).padStart(3, '0')}`));
    const wires = parts.map((item, index) => wire(`w${index}`, 'uno', `${index}`, item.id, 'A'));
    wires.push(wire('loop', 'p000', 'A', 'p000', 'C'));
    const model = buildSchematicModel([board], parts, wires);
    expect(model.parts).toHaveLength(81);
    expect(model.routes).toHaveLength(81);
    for (const a of model.parts) for (const b of model.parts) {
      if (a.id === b.id) continue;
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    }
    for (const route of model.routes) for (let index = 1; index < route.points.length; index++) {
      const a = route.points[index - 1]; const b = route.points[index];
      for (const symbol of model.parts) {
        const overlaps = a.x === b.x
          ? a.x > symbol.x && a.x < symbol.x + symbol.width && Math.max(a.y, b.y) > symbol.y && Math.min(a.y, b.y) < symbol.y + symbol.height
          : a.y > symbol.y && a.y < symbol.y + symbol.height && Math.max(a.x, b.x) > symbol.x && Math.min(a.x, b.x) < symbol.x + symbol.width;
        expect(overlaps).toBe(false);
      }
    }
  });
  it('fits mobile viewports and keeps the zoom anchor fixed within zoom limits', () => {
    const model = buildSchematicModel([board], [part('led')], [wire('w1', 'uno', '13', 'led', 'A')]);
    const view = fitSchematic(model.bounds, 320, 200);
    expect(view.x + model.bounds.x * view.scale).toBeGreaterThanOrEqual(0);
    expect(view.y + model.bounds.y * view.scale).toBeGreaterThanOrEqual(0);
    const anchor = { x: 120, y: 90 };
    const zoomed = zoomSchematic(view, 1.5, anchor);
    expect((anchor.x - zoomed.x) / zoomed.scale).toBeCloseTo((anchor.x - view.x) / view.scale);
    expect((anchor.y - zoomed.y) / zoomed.scale).toBeCloseTo((anchor.y - view.y) / view.scale);
    expect(zoomSchematic(view, 1e9, anchor).scale).toBe(4);
    expect(zoomSchematic(view, 1e-9, anchor).scale).toBe(0.01);
  });
});
