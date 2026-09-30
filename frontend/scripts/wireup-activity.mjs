import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
let requested; let sequence = 0; let results = [];
try {
  await page.route('**/api/ai/chat/status', route => route.fulfill({ json: { configured: true, model: 'activity-test', message: 'Test provider settings' } }));
  await page.route('**/api/ai/chat/turn', route => {
    const messages = route.request().postDataJSON().messages;
    const last = messages.at(-1);
    if (last.role === 'tool') {
      results.push(JSON.parse(last.content));
      return route.fulfill({ json: { model: 'activity-test', message: { role: 'assistant', content: 'The actual tool result was received.' } } });
    }
    return route.fulfill({ json: { model: 'activity-test', message: { role: 'assistant', content: null, tool_calls: [{ id: `activity-${++sequence}`, type: 'function', function: { name: requested.name, arguments: JSON.stringify(requested.args) } }] } } });
  });
  await page.goto('http://localhost:5173/');
  await page.getByRole('button', { name: 'Blink an LED', exact: true }).click();
  await page.waitForURL('**/editor');
  const assistant = page.locator('.wu-assistant');
  await assistant.getByLabel('Use project tools').check();
  async function submit(name, args) {
    requested = { name, args };
    await assistant.getByLabel('What would you like to build or fix?').fill('Perform the requested test operation');
    await assistant.getByRole('button', { name: 'Ask Wireup', exact: true }).click();
  }
  const source = await page.evaluate(() => window.__velxioStores.useEditorStore.getState().files[0]);
  await submit('set_firmware', { file: source.id, content: '// replacement' });
  await expect(assistant.getByRole('dialog', { name: 'Confirm project change' })).toBeVisible();
  expect(await page.evaluate(() => window.__velxioStores.useEditorStore.getState().files[0].content)).toBe(source.content);
  await assistant.getByRole('button', { name: 'Reject change', exact: true }).click();
  await expect(assistant.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
  expect(results.at(-1).success).toBe(false);
  expect(await page.evaluate(() => window.__velxioStores.useEditorStore.getState().files[0].content)).toBe(source.content);
  await submit('set_firmware', { file: source.id, content: '// replacement' });
  await assistant.getByRole('button', { name: 'Allow change', exact: true }).click();
  await expect(assistant.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
  expect(results.at(-1).success).toBe(true);
  expect(await page.evaluate(() => window.__velxioStores.useEditorStore.getState().files[0].content)).toBe('// replacement');
  await submit('add_component', { component_type: 'led', position: { x: 550, y: 100 } });
  await expect(assistant.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
  const led = results.at(-1).data.component_id;
  await submit('remove_component', { component_id: led });
  await expect(assistant.getByRole('dialog')).toBeVisible();
  await assistant.getByRole('button', { name: 'Allow change', exact: true }).click();
  await expect(assistant.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
  expect(await page.evaluate(id => window.__velxioStores.useSimulatorStore.getState().components.some(item => item.id === id), led)).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(id => window.__velxioStores.useSimulatorStore.getState().components.some(item => item.id === id), led)).toBe(true);
  await submit('remove_component', { component_id: led });
  await expect(assistant.getByRole('dialog')).toBeVisible();
  await assistant.getByRole('button', { name: 'Cancel request' }).click();
  await expect(assistant.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(id => window.__velxioStores.useSimulatorStore.getState().components.some(item => item.id === id), led)).toBe(true);
  await assistant.getByRole('button', { name: 'New chat', exact: true }).click();
  await submit('connect', { from_component: 'missing', from_pin: '7', to_component: led, to_pin: 'A' });
  await expect(assistant.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
  expect(results.at(-1).success).toBe(false);
  await assistant.locator('.wu-ai-activity-details').last().locator('summary').click();
  await expect(assistant.locator('.wu-ai-activity')).toContainText('does not exist');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.wu-header .wu-theme-toggle').click();
  await expect(assistant.locator('.wu-ai-activity')).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS real activity and approval: firmware reject/allow, component removal/cancel, existing Undo, actual tool error, mobile/light. Model responses were controlled test fixtures.');
} finally { await browser.close(); }
