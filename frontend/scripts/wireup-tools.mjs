import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
async function call(name, args = {}) {
  return page.evaluate(async ({ name, args }) => {
    const { executeWireupTool } = await import('/src/wireup/tools/index.ts');
    return executeWireupTool(name, args);
  }, { name, args });
}
function ok(value) { expect(value.success, JSON.stringify(value)).toBe(true); return value.data; }
try {
  await page.goto('http://127.0.0.1:5173/');
  expect((await call('compile_firmware')).success).toBe(false);
  await page.getByRole('button', { name: 'Build a traffic light', exact: true }).click();
  await page.waitForURL('**/editor');
  await expect(page.locator('.wu-live-canvas')).toBeVisible();
  const initial = ok(await call('get_project_state'));
  const board = initial.parts.find(part => part.component_type === 'arduino-uno');
  expect(board.pins_available).toBe(true);
  const search = ok(await call('search_components', { query: 'resistor' }));
  expect(search.components.some(part => part.component_type === 'resistor')).toBe(true);
  expect((await call('add_component', { component_type: 'invented-component' })).success).toBe(false);
  const led = ok(await call('add_component', { component_type: 'led', position: { x: 750, y: 180 } }));
  await expect(page.locator(`[id="${led.component_id}"]`)).toBeAttached();
  ok(await call('set_component_property', { component_id: led.component_id, property: 'color', value: 'blue' }));
  expect((await call('set_component_property', { component_id: led.component_id, property: 'no-such-property', value: 2 })).success).toBe(false);
  const wire = ok(await call('connect', { from_component: board.id, from_pin: '12', to_component: led.component_id, to_pin: 'A' }));
  expect(wire.wire.autoRouted).toBe(true);
  expect((await call('connect', { from_component: led.component_id, from_pin: 'A', to_component: board.id, to_pin: '12' })).success).toBe(false);
  expect((await call('connect', { from_component: board.id, from_pin: 'MISSING', to_component: led.component_id, to_pin: 'C' })).success).toBe(false);
  ok(await call('disconnect', { wire_id: wire.wire.id }));
  ok(await call('remove_component', { component_id: led.component_id }));
  const firmware = ok(await call('get_firmware'));
  const file = firmware.files.find(file => file.group_id === firmware.active_group_id && file.name.endsWith('.ino'));
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  const source = `${file.content.replace(/void setup\(\)\s*\{/, 'void setup() {\n  Serial.begin(9600);\n  Serial.println("Wireup tools serial verified");')}\n// Tool layer verification\n`;
  ok(await call('set_firmware', { file: file.file, content: source }));
  await expect(page.locator('.monaco-editor').first()).toContainText('Tool layer verification');
  const compiled = ok(await call('compile_firmware'));
  expect(compiled).toBeTruthy();
  const started = ok(await call('start_simulation'));
  expect(started).toBeTruthy();
  await expect.poll(async () => ok(await call('get_simulation_state')).running).toBe(true);
  expect((await call('remove_component', { component_id: board.id })).success).toBe(false);
  await expect.poll(async () => ok(await call('get_serial_output')).output).toContain('Wireup tools serial verified');
  const serial = ok(await call('get_serial_output'));
  expect(serial.format).toBe('monitor_text');
  ok(await call('stop_simulation'));
  expect(ok(await call('get_simulation_state')).running).toBe(false);
  ok(await call('set_firmware', { file: file.file, content: 'this is invalid Arduino source !!!' }));
  const failed = await call('compile_firmware');
  expect(failed.success, JSON.stringify(failed)).toBe(false);
  expect(ok(await call('get_simulation_state')).boards.find(item => item.component_id === board.id).program_loaded).toBe(false);
  ok(await call('set_firmware', { file: file.file, content: source }));
  await page.evaluate(async boardId => {
    const { getBoardSimulator } = await import('/src/store/useSimulatorStore.ts');
    const simulator = getBoardSimulator(boardId);
    window.__restoreToolLoader = () => { simulator.loadHex = window.__toolOriginalLoader; };
    window.__toolOriginalLoader = simulator.loadHex;
    simulator.loadHex = () => { throw new Error('Injected runtime load failure'); };
  }, board.id);
  const unloadable = await call('compile_firmware');
  expect(unloadable.success, JSON.stringify(unloadable)).toBe(false);
  await page.evaluate(() => window.__restoreToolLoader());
  // A delayed actual build must not apply to edited source or start after Stop.
  await page.route('**/api/compile/status/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.evaluate(() => {
    window.__toolPending = import('/src/wireup/tools/index.ts').then(tools => tools.compile_firmware());
  });
  await expect.poll(async () => ok(await call('get_simulation_state')).busy).toBe(true);
  expect((await call('set_firmware', { file: file.file, content: 'blocked while busy' })).success).toBe(false);
  await page.locator('.monaco-editor .view-lines').first().click();
  await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.insertText('// Newer edit while build pending');
  const superseded = await page.evaluate(() => window.__toolPending);
  expect(superseded.success, JSON.stringify(superseded)).toBe(false);
  await page.unroute('**/api/compile/status/**');
  ok(await call('set_firmware', { file: file.file, content: source }));
  await page.route('**/api/compile/status/**', async route => { await new Promise(resolve => setTimeout(resolve, 1500)); await route.continue(); });
  await page.evaluate(() => { window.__toolPending = import('/src/wireup/tools/index.ts').then(tools => tools.start_simulation()); });
  await expect.poll(async () => ok(await call('get_simulation_state')).busy).toBe(true);
  ok(await call('stop_simulation'));
  const cancelled = await page.evaluate(() => window.__toolPending);
  expect(cancelled.success, JSON.stringify(cancelled)).toBe(false);
  expect(ok(await call('get_simulation_state')).running).toBe(false);
  await page.unroute('**/api/compile/status/**');
  await page.getByTitle('Save project (Ctrl+S)', { exact: true }).click();
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  await page.getByRole('button', { name: /Schematic/ }).click();
  await expect(page.locator('.wu-schematic')).toBeVisible();
  const updated = ok(await call('get_project_state'));
  expect(updated.snapshot.editor.fileGroups[firmware.active_group_id].some(item => item.content === source)).toBe(true);
  await page.getByRole('link', { name: 'Build pack', exact: true }).click();
  await expect(page.locator('.wu-prototype-summary')).toContainText('Traffic');
  expect((await call('start_simulation')).success).toBe(false);
  await page.getByRole('link', { name: 'Workspace', exact: true }).click();
  await expect(page.locator('.wu-home-project')).not.toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5173/editor');
  await expect(page.locator('.wu-studio-toolbar')).toBeVisible();
  ok(await call('get_firmware'));
  expect(errors).toEqual([]);
  console.log('PASS Wireup tool layer: real catalog, placement, property edits, routing, firmware, compile/failure, start/stop, serial, stale-build and stopped-start guards, shared routes. PAGE_ERRORS', errors);
} finally { await browser.close(); }
