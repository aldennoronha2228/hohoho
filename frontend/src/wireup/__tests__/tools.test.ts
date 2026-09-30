// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentRegistry } from '../../services/ComponentRegistry';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { useEditorStore } from '../../store/useEditorStore';
import { useElectricalStore } from '../../store/useElectricalStore';
import { useWireupProject } from '../project';
import { registerToolRuntime } from '../tools/runtime';
import * as tools from '../tools';

// Metadata comes from the production catalog, not a test component list.
vi.hoisted(() => {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    if (args[0] === '/components-metadata.json') {
      const { readFileSync } = await import('node:fs');
      return new Response(readFileSync('public/components-metadata.json', 'utf-8'));
    }
    return nativeFetch(...args);
  }) as typeof fetch;
});
beforeAll(async () => { await ComponentRegistry.getInstance().load(); });
let unmountFixture: (() => void) | undefined;
const wireActions = { startWireCreation: useSimulatorStore.getState().startWireCreation, finishWireCreation: useSimulatorStore.getState().finishWireCreation };
const addFileToGroup = useEditorStore.getState().addFileToGroup;
beforeEach(() => {
  useSimulatorStore.setState(wireActions);
  useEditorStore.setState({ addFileToGroup });
  document.body.innerHTML = '';
  useSimulatorStore.getState().setComponents([]);
  useSimulatorStore.getState().setWires([]);
  useSimulatorStore.setState({ boards: [], activeBoardId: null, running: false, wireInProgress: null, serialOutput: '' });
  useEditorStore.setState({ activeGroupId: 'group', fileGroups: { group: [{ id: 'file', name: 'sketch.ino', content: 'void setup() {}', modified: false }] }, files: [{ id: 'file', name: 'sketch.ino', content: 'void setup() {}', modified: false }], activeGroupFileId: { group: 'file' }, openGroupFileIds: { group: ['file'] }, folderGroups: {}, codeChangedSinceLastCompile: false });
  useWireupProject.setState({ project: null, dirty: false, saving: false, error: null });
  useElectricalStore.getState().setPaused(false);
  // These DOM fixtures stand in for the mounted canvas; production reads only pinInfo.
  unmountFixture = useSimulatorStore.subscribe(state => {
    for (const part of [...state.components, ...state.boards]) {
      if (!document.getElementById(part.id)) mountPins(part.id, ['A', 'C']);
    }
  });
});
afterEach(() => { unmountFixture?.(); vi.useRealTimers(); vi.restoreAllMocks(); });
function mountPins(id: string, names: string[]) {
  document.getElementById(id)?.remove();
  const element = document.createElement('div');
  element.id = id;
  Object.defineProperty(element, 'pinInfo', { value: names.map((name, index) => ({ name, x: index * 20, y: 10 })) });
  document.body.append(element);
}
async function addLed() {
  const added = await tools.add_component('led', { x: 100, y: 100 });
  if (!added.success) throw new Error(added.error);
  return added.data.component_id;
}

describe('Wireup tools with existing stores and real metadata', () => {
  it('provides exactly the requested tool names and rejects unknown tools/arguments', async () => {
    expect(Object.keys(tools.toolInputSchemas)).toHaveLength(18);
    expect(Object.keys(tools.toolInputSchemas)).toEqual(expect.arrayContaining(['get_circuit', 'update_connection', 'add_firmware_file']));
    expect(await tools.executeWireupTool('setState', {})).toMatchObject({ success: false });
    expect(await tools.executeWireupTool('get_firmware', { extra: true })).toMatchObject({ success: false });
    expect(await tools.executeWireupTool('add_component', { component_type: 'led', position: { x: '100', y: 0 } })).toMatchObject({ success: false });
  });
  it('searches the real component registry and reports unknown types', async () => {
    const found = await tools.search_components('resistor');
    expect(found.success).toBe(true);
    if (found.success) expect(found.data.components.some(part => part.component_type === 'resistor')).toBe(true);
    expect(await tools.add_component('does-not-exist')).toMatchObject({ success: false });
    expect(await tools.search_components(null as unknown as string)).toMatchObject({ success: false });
  });
  it('creates real default properties and records placement for undo', async () => {
    const result = await tools.add_component('resistor', { x: 12, y: 24 });
    expect(result.success).toBe(true);
    expect(useSimulatorStore.getState().components[0]).toMatchObject({ metadataId: 'resistor', x: 12, y: 24, properties: { rotation: 90 } });
    useSimulatorStore.getState().undo();
    expect(useSimulatorStore.getState().components).toHaveLength(0);
    expect(await tools.add_component('led', { x: NaN, y: 0 })).toMatchObject({ success: false });
  });
  it('adds and removes boards through existing board lifecycle and cascades wires', async () => {
    const board = await tools.add_component('arduino-uno', { x: 20, y: 30 });
    if (!board.success) throw new Error(board.error);
    expect(useSimulatorStore.getState().boards[0]).toMatchObject({ id: board.data.component_id, boardKind: 'arduino-uno', x: 20, y: 30 });
    expect(await tools.set_component_property(board.data.component_id, 'color', 'red')).toMatchObject({ success: false });
    expect(await tools.remove_component(board.data.component_id)).toMatchObject({ success: true });
    expect(useSimulatorStore.getState().boards).toHaveLength(0);
  });

  it('waits for asynchronously mounted DOM pin info before a subsequent connect', async () => {
    unmountFixture?.();
    vi.useFakeTimers();
    const pending = tools.executeWireupTool('add_component', { component_type: 'led' });
    await vi.advanceTimersByTimeAsync(0);
    const cid = useSimulatorStore.getState().components[0].id;
    const element = document.createElement('div');
    element.id = cid;
    document.body.append(element);
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    mountPins(cid, ['REAL_ANODE', 'REAL_CATHODE']);
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toMatchObject({ success: true, data: { component_id: cid, pins_available: true, pins: [{ name: 'REAL_ANODE' }, { name: 'REAL_CATHODE' }] } });
    expect(await tools.connect(cid, 'REAL_ANODE', cid, 'REAL_CATHODE')).toMatchObject({ success: true });
  });
  it('reports created but unmounted components and boards after the bounded wait without rollback', async () => {
    unmountFixture?.();
    vi.useFakeTimers();
    for (const kind of ['led', 'arduino-uno']) {
      const pending = tools.add_component(kind);
      await vi.advanceTimersByTimeAsync(0);
      const state = useSimulatorStore.getState();
      const cid = kind === 'led' ? state.components[0].id : state.boards[0].id;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await pending).toMatchObject({ success: false, error: expect.stringContaining(`${cid} was created but is unmounted`) });
      expect(await tools.get_project_state()).toMatchObject({ success: true, data: { parts: expect.arrayContaining([{ id: cid, component_type: kind, pins_available: false, pins: [] }]) } });
    }
  });

  it('updates declared properties through existing actions with undo and validation', async () => {
    const cid = await addLed();
    const old = useSimulatorStore.getState().components[0].properties.color;
    expect(await tools.set_component_property(cid, 'color', 'blue')).toMatchObject({ success: true });
    expect(useSimulatorStore.getState().components[0].properties.color).toBe('blue');
    useSimulatorStore.getState().undo();
    expect(useSimulatorStore.getState().components[0].properties.color).toBe(old);
    expect(await tools.set_component_property(cid, '__proto__', {})).toMatchObject({ success: false });
    expect(await tools.set_component_property(cid, 'nonexistent', true)).toMatchObject({ success: false });
    expect(await tools.set_component_property(cid, 'rotation', 13)).toMatchObject({ success: false });
    expect(await tools.set_component_property(cid, 'color', { bad: true })).toMatchObject({ success: false });
    expect(await tools.set_component_property(cid, 'color', 'notacolor')).toMatchObject({ success: false });
    expect(await tools.executeWireupTool('set_component_property', { component_id: cid, property: 'color' })).toMatchObject({ success: false });
  });
  it('enforces number limits and booleans from production descriptors', async () => {
    const catalog = ComponentRegistry.getInstance();
    const numeric = catalog.getAllComponents().flatMap(part => part.properties.filter(prop => prop.type === 'number' && prop.min !== undefined).map(prop => ({ part, prop })))[0];
    expect(numeric).toBeDefined();
    const added = await tools.add_component(numeric.part.id);
    if (!added.success) throw new Error(added.error);
    expect(await tools.set_component_property(added.data.component_id, numeric.prop.name, numeric.prop.min! - 1)).toMatchObject({ success: false });
    expect(await tools.set_component_property(added.data.component_id, numeric.prop.name, Infinity)).toMatchObject({ success: false });
  });
  it('connects through existing auto-routing and supports undo, redo, disconnect and cascade removal', async () => {
    const a = await addLed(); const b = await addLed();
    const started = vi.spyOn(useSimulatorStore.getState(), 'startWireCreation');
    const finished = vi.spyOn(useSimulatorStore.getState(), 'finishWireCreation');
    const connected = await tools.connect(a, 'A', b, 'C');
    expect(connected.success).toBe(true);
    expect(started).toHaveBeenCalledOnce(); expect(finished).toHaveBeenCalledOnce();
    started.mockRestore(); finished.mockRestore();
    if (!connected.success) throw new Error(connected.error);
    expect(connected.data.wire.autoRouted).toBe(true);
    expect(connected.data.wire.start.x).toBe(106);
    expect(await tools.connect(b, 'C', a, 'A')).toMatchObject({ success: false, error: expect.stringContaining('already connected') });
    useSimulatorStore.getState().undo(); expect(useSimulatorStore.getState().wires).toHaveLength(0);
    useSimulatorStore.getState().redo(); expect(useSimulatorStore.getState().wires).toHaveLength(1);
    expect(await tools.disconnect(connected.data.wire.id)).toMatchObject({ success: true });
    useSimulatorStore.getState().undo();
    expect(await tools.remove_component(a)).toMatchObject({ success: true });
    expect(useSimulatorStore.getState().wires).toHaveLength(0);
    useSimulatorStore.getState().undo(); expect(useSimulatorStore.getState().wires).toHaveLength(1);
  });
  it('updates connections with the existing router, stable ID, color, selection and undo/redo', async () => {
    const a = await addLed(); const b = await addLed();
    const connected = await tools.connect(a, 'A', b, 'C');
    if (!connected.success) throw new Error(connected.error);
    const previous = useSimulatorStore.getState().wires[0];
    useSimulatorStore.getState().setSelectedWire(previous.id);
    const started = vi.spyOn(useSimulatorStore.getState(), 'startWireCreation');
    const finished = vi.spyOn(useSimulatorStore.getState(), 'finishWireCreation');
    const updated = await tools.executeWireupTool('update_connection', { wire_id: previous.id, from_component: a, from_pin: 'C', to_component: b, to_pin: 'A' });
    expect(updated).toMatchObject({ success: true, data: { wire: { id: previous.id, color: previous.color, autoRouted: true, start: { pinName: 'C' }, end: { pinName: 'A' } } } });
    expect(started).toHaveBeenCalledOnce(); expect(finished).toHaveBeenCalledOnce();
    expect(useSimulatorStore.getState().wires).toHaveLength(1);
    expect(useSimulatorStore.getState().selectedWireId).toBe(previous.id);
    const next = useSimulatorStore.getState().wires[0];
    useSimulatorStore.getState().undo(); expect(useSimulatorStore.getState().wires[0]).toEqual(previous);
    useSimulatorStore.getState().redo(); expect(useSimulatorStore.getState().wires[0]).toEqual(next);
    expect(await tools.disconnect(previous.id)).toMatchObject({ success: true });
    useSimulatorStore.getState().undo(); expect(useSimulatorStore.getState().wires[0]).toEqual(next);
  });
  it('validates updates before mutation and rolls back even a router failure after creation', async () => {
    const a = await addLed(); const b = await addLed();
    await tools.connect(a, 'A', b, 'C');
    await tools.connect(a, 'C', b, 'A');
    const state = useSimulatorStore.getState();
    const previous = state.wires[0];
    state.setSelectedWire(previous.id);
    const baseline = useSimulatorStore.getState();
    for (const [wire, from, pin, to, end] of [
      ['missing', a, 'A', b, 'C'], [previous.id, a, 'missing', b, 'C'],
      [previous.id, a, 'A', a, 'A'], [previous.id, b, 'A', a, 'C'],
    ]) {
      expect(await tools.update_connection(wire, from, pin, to, end)).toMatchObject({ success: false });
      expect(useSimulatorStore.getState().wires).toEqual(baseline.wires);
      expect(useSimulatorStore.getState().history).toEqual(baseline.history);
    }
    const finish = useSimulatorStore.getState().finishWireCreation;
    vi.spyOn(useSimulatorStore.getState(), 'finishWireCreation').mockImplementation(end => { finish(end); throw new Error('router failed'); });
    expect(await tools.update_connection(previous.id, a, 'A', b, 'A')).toEqual({ success: false, error: 'router failed' });
    expect(useSimulatorStore.getState().wires).toEqual(baseline.wires);
    expect(useSimulatorStore.getState().history).toEqual(baseline.history);
    expect(useSimulatorStore.getState().selectedWireId).toBe(previous.id);
    expect(useSimulatorStore.getState().wireInProgress).toBeNull();
  });
  it('allows keeping an occupied breadboard endpoint belonging to the updated wire only', async () => {
    const a = await addLed();
    const bb = await tools.add_component('breadboard');
    if (!bb.success) throw new Error(bb.error);
    mountPins(bb.data.component_id, ['1t.a', '1t.b']);
    const connected = await tools.connect(a, 'A', bb.data.component_id, '1t.a');
    if (!connected.success) throw new Error(connected.error);
    const wireId = connected.data.wire.id;
    expect(await tools.update_connection(wireId, a, 'C', bb.data.component_id, '1t.a')).toMatchObject({ success: true });
    useSimulatorStore.getState().addWire({ id: 'occupied', start: { componentId: a, pinName: 'A', x: 0, y: 0 }, end: { componentId: bb.data.component_id, pinName: '1t.b', x: 10, y: 10 }, waypoints: [], color: '#000' });
    expect(await tools.update_connection(wireId, a, 'C', bb.data.component_id, '1t.b')).toMatchObject({ success: false, error: expect.stringContaining('occupied') });
    useSimulatorStore.getState().updateWire(wireId, { bb: true });
    expect(await tools.update_connection(wireId, a, 'C', bb.data.component_id, '1t.a')).toMatchObject({ success: false, error: expect.stringContaining('seating') });
  });

  it('rejects missing/unmounted pins, self connections and protected seating wires', async () => {
    const a = await addLed(); const b = await addLed();
    expect(await tools.connect(a, 'A', a, 'A')).toMatchObject({ success: false });
    expect(await tools.connect(a, 'missing', b, 'C')).toMatchObject({ success: false });
    expect(await tools.connect('unknown', 'A', b, 'C')).toMatchObject({ success: false });
    document.getElementById(a)!.remove();
    expect(await tools.connect(a, 'A', b, 'C')).toMatchObject({ success: false });
    useSimulatorStore.getState().addWire({ id: 'seat', start: { componentId: a, pinName: 'A', x: 0, y: 0 }, end: { componentId: b, pinName: 'C', x: 0, y: 0 }, waypoints: [], color: '#000', bb: true });
    expect(await tools.disconnect('seat')).toMatchObject({ success: false });
    expect(await tools.disconnect('unknown')).toMatchObject({ success: false });
    expect(await tools.remove_component('unknown')).toMatchObject({ success: false });
  });
  it('rejects an occupied breadboard hole without rerouting to a different requested pin', async () => {
    const a = await addLed();
    const bb = await tools.add_component('breadboard');
    if (!bb.success) throw new Error(bb.error);
    mountPins(bb.data.component_id, ['1t.a', '1t.b']);
    useSimulatorStore.getState().addWire({ id: 'occupied', start: { componentId: a, pinName: 'A', x: 0, y: 0 }, end: { componentId: bb.data.component_id, pinName: '1t.a', x: 10, y: 10 }, waypoints: [], color: '#000' });
    expect(await tools.connect(a, 'C', bb.data.component_id, '1t.a')).toMatchObject({ success: false, error: expect.stringContaining('occupied') });
  });
  it('does not overwrite an interactive wire and creates unique IDs for rapid connections', async () => {
    const a = await addLed(); const b = await addLed();
    const state = useSimulatorStore.getState();
    state.startWireCreation({ componentId: a, pinName: 'A', x: 0, y: 0 }, '#000');
    expect(await tools.connect(a, 'A', b, 'C')).toMatchObject({ success: false });
    state.cancelWireCreation();
    vi.spyOn(Date, 'now').mockReturnValue(123);
    expect(await tools.connect(a, 'A', b, 'C')).toMatchObject({ success: true });
    expect(await tools.connect(a, 'C', b, 'A')).toMatchObject({ success: true });
    expect(new Set(useSimulatorStore.getState().wires.map(wire => wire.id)).size).toBe(2);
    vi.restoreAllMocks();
  });
  it('reads detached JSON snapshots rather than leaking mutable store values', async () => {
    const cid = await addLed();
    const state = await tools.get_project_state();
    expect(state.success).toBe(true);
    if (!state.success) throw new Error(state.error);
    expect(state.data.parts.find(part => part.id === cid)?.pins).toEqual([{ name: 'A' }, { name: 'C' }]);
    state.data.snapshot.circuit.components[0].x = 999;
    expect(useSimulatorStore.getState().components[0].x).toBe(100);
    expect(() => JSON.stringify(state)).not.toThrow();
  });
  it('exposes get_circuit as a detached live snapshot alias with only mounted pins', async () => {
    const cid = await addLed();
    expect(tools.get_circuit).toBe(tools.get_project_state);
    vi.useFakeTimers();
    expect(await tools.executeWireupTool('get_circuit')).toEqual(await tools.get_project_state());
    vi.useRealTimers();
    useSimulatorStore.getState().updateComponent(cid, { x: 321 });
    mountPins(cid, ['DOM_PIN']);
    const live = await tools.get_circuit();
    if (!live.success) throw new Error(live.error);
    expect(live.data.snapshot.circuit.components[0].x).toBe(321);
    expect(live.data.parts[0].pins).toEqual([{ name: 'DOM_PIN' }]);
    live.data.parts[0].pins[0].name = 'detached';
    document.getElementById(cid)!.remove();
    expect(await tools.get_circuit()).toMatchObject({ success: true, data: { parts: [{ id: cid, pins_available: false, pins: [] }] } });
  });
  it('adds firmware through existing editor groups without overwriting or switching the active group', async () => {
    const add = vi.spyOn(useEditorStore.getState(), 'addFileToGroup');
    const created = await tools.executeWireupTool('add_firmware_file', { name: 'src/helper.h', content: '#pragma once' });
    expect(created).toMatchObject({ success: true, data: { name: 'src/helper.h', content: '#pragma once', group_id: 'group', file: expect.any(String) } });
    expect(add).toHaveBeenCalledWith('group', { name: 'src/helper.h', content: '#pragma once' });
    expect(useEditorStore.getState().files).toHaveLength(2);
    expect(useEditorStore.getState().codeChangedSinceLastCompile).toBe(true);
    useEditorStore.setState({ fileGroups: { ...useEditorStore.getState().fileGroups, other: [] }, codeChangedSinceLastCompile: false });
    expect(await tools.add_firmware_file('src\\other.h', '', 'other')).toMatchObject({ success: true, data: { name: 'src/other.h', group_id: 'other' } });
    expect(useEditorStore.getState().activeGroupId).toBe('group');
    expect(useEditorStore.getState().files).toHaveLength(2);
    expect(useEditorStore.getState().codeChangedSinceLastCompile).toBe(true);
    expect(await tools.add_firmware_file('src/helper.h', 'overwrite')).toMatchObject({ success: false });
    expect(await tools.add_firmware_file('SRC\\HELPER.H', 'overwrite')).toMatchObject({ success: false });
    expect(await tools.add_firmware_file('new.h', '', 'missing')).toMatchObject({ success: false });
    expect(await tools.add_firmware_file('new.h', '', '__proto__')).toMatchObject({ success: false });
    expect(useEditorStore.getState().files[1].content).toBe('#pragma once');
    expect(await tools.set_firmware('missing.h', '')).toMatchObject({ success: false });
  });
  it('rejects unsafe firmware paths and invalid content before touching the editor', async () => {
    const add = vi.spyOn(useEditorStore.getState(), 'addFileToGroup');
    for (const name of ['../evil.h', 'src/../evil.h', 'src\\..\\evil.h', '/absolute.h', '\\absolute.h', 'C:\\absolute.h', 'C:relative.h', '//server/share.h', 'src//bad.h', './bad.h', 'src/./bad.h', 'bad\u0000.h', 'bad?.h', 'bad*.h', 'bad|.h', 'bad<.h', 'bad>.h', 'bad".h', 'NUL.h', 'src/COM1.h', 'src/bad./x.h', 'src/bad /x.h']) {
      expect(await tools.add_firmware_file(name, '')).toMatchObject({ success: false });
    }
    expect(await tools.add_firmware_file('', '')).toMatchObject({ success: false });
    expect(await tools.add_firmware_file('new.h', 123 as unknown as string)).toMatchObject({ success: false });
    expect(await tools.add_firmware_file('new.h', 'x'.repeat(2_000_001))).toMatchObject({ success: false });
    expect(add).not.toHaveBeenCalled();
    expect(useEditorStore.getState().files).toHaveLength(1);
  });

  it('updates firmware by ID/name and invalidates inactive group builds without switching editor', async () => {
    expect(await tools.set_firmware('sketch.ino', '// changed')).toMatchObject({ success: true });
    expect(useEditorStore.getState().files[0].content).toBe('// changed');
    useEditorStore.setState({ fileGroups: { ...useEditorStore.getState().fileGroups, other: [{ id: 'other-file', name: 'sketch.ino', content: 'old', modified: false }] }, codeChangedSinceLastCompile: false });
    expect(await tools.set_firmware('sketch.ino', 'ambiguous')).toMatchObject({ success: false });
    expect(await tools.set_firmware('other-file', '// other')).toMatchObject({ success: true });
    expect(useEditorStore.getState().activeGroupId).toBe('group');
    expect(useEditorStore.getState().fileGroups.other[0].content).toBe('// other');
    expect(useEditorStore.getState().codeChangedSinceLastCompile).toBe(true);
    expect(await tools.set_firmware('missing', '')).toMatchObject({ success: false });
    expect(await tools.set_firmware('file', 123 as unknown as string)).toMatchObject({ success: false });
    const read = await tools.get_firmware();
    if (read.success) expect(read.data.files).toHaveLength(2);
  });
  it('blocks project mutations while running or while the real runtime reports busy', async () => {
    const cid = await addLed();
    useSimulatorStore.setState({ running: true });
    expect(await tools.remove_component(cid)).toMatchObject({ success: false });
    expect(await tools.set_firmware('file', 'bad')).toMatchObject({ success: false });
    expect(await tools.add_firmware_file('new.h', '')).toMatchObject({ success: false });
    expect(await tools.update_connection('missing', cid, 'A', cid, 'C')).toMatchObject({ success: false, error: expect.stringContaining('Stop all simulations') });
    useSimulatorStore.setState({ running: false });
    const dispose = registerToolRuntime({ compile: async () => ({ success: false, error: 'not used' }), start: async () => ({ success: false, error: 'not used' }), stop: () => ({ success: true, data: {} }), busy: () => true });
    try {
      expect(await tools.add_component('led')).toMatchObject({ success: false });
      expect(await tools.add_firmware_file('new.h', '')).toMatchObject({ success: false });
      expect(await tools.update_connection('missing', cid, 'A', cid, 'C')).toMatchObject({ success: false, error: expect.stringContaining('Wait for the current build') });
    } finally { dispose(); }
  });
  it('returns unavailable errors, awaits registered operations, propagates failures and preserves owner cleanup', async () => {
    expect(await tools.compile_firmware()).toMatchObject({ success: false });
    expect(await tools.start_simulation()).toMatchObject({ success: false });
    expect(await tools.stop_simulation()).toMatchObject({ success: false });
    const old = registerToolRuntime({ compile: async () => ({ success: true, data: {} }), start: async () => ({ success: true, data: {} }), stop: () => ({ success: true, data: {} }), busy: () => false });
    let finish!: (value: tools.ToolResult) => void;
    const dispose = registerToolRuntime({ compile: () => new Promise(resolve => { finish = resolve; }), start: async () => ({ success: false, error: 'Circuit check blocked' }), stop: () => ({ success: true, data: { stopped: true } }), busy: () => false });
    old();
    try {
      const pending = tools.compile_firmware();
      finish({ success: false, error: 'Real compiler failure' });
      expect(await pending).toEqual({ success: false, error: 'Real compiler failure' });
      expect(await tools.start_simulation()).toEqual({ success: false, error: 'Circuit check blocked' });
      expect(await tools.stop_simulation()).toEqual({ success: true, data: { stopped: true } });
    } finally { dispose(); }
  });
  it('returns actual serial monitor and simulation state as JSON', async () => {
    useSimulatorStore.setState({ serialOutput: 'hello\n', running: true });
    useElectricalStore.getState().setPaused(true);
    expect(await tools.get_serial_output()).toMatchObject({ success: true, data: { output: 'hello\n', format: 'monitor_text' } });
    expect(await tools.get_simulation_state()).toMatchObject({ success: true, data: { running: true, electrical_paused: true } });
  });
});
