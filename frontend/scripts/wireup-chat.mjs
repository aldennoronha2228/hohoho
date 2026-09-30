import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const live = process.env.WIREUP_CHAT_LIVE === '1';
const root = 'http://localhost:5173';
try {
  if (!live) {
    await page.route('**/api/ai/chat/status', route => route.fulfill({ json: { configured: true, model: 'browser-test', message: 'Test settings configured; connectivity not checked.' } }));
    await page.route('**/api/ai/chat', route => {
      const payload = route.request().postDataJSON();
      expect(Object.keys(payload)).toEqual(['messages']);
      return route.fulfill({ json: { message: { role: 'assistant', content: payload.messages.length === 1 ? 'Test transport response for a temperature monitor.' : 'Test follow-up response.' }, model: 'browser-test' } });
    });
  }
  await page.goto(root);
  const assistant = page.locator('.wu-home-assistant');
  await assistant.locator('.wu-ai-configuration summary').click();
  await expect(assistant).toContainText('Plain chat sends only the conversation');
  if (live) {
    const status = await page.request.get(root + '/api/ai/chat/status');
    expect((await status.json()).configured, 'A server-side AI_API_KEY is required for live verification.').toBe(true);
  }
  const input = assistant.getByLabel('What would you like to build or fix?');
  await input.fill('Build an Arduino temperature monitor. Explain the parts you would use; do not claim you built it.');
  await assistant.getByRole('button', { name: 'Ask Wireup', exact: true }).click();
  await expect(assistant.getByLabel('AI response')).toBeVisible({ timeout: 95000 });
  const first = await assistant.getByLabel('AI response').innerText();
  expect(first.length).toBeGreaterThan(20);
  await input.fill('Which display would you recommend for that project?');
  await assistant.getByRole('button', { name: 'Ask Wireup', exact: true }).click();
  await expect(assistant.getByLabel('AI response')).toHaveCount(2, { timeout: 95000 });
  await assistant.getByRole('button', { name: 'New chat' }).click();
  await expect(assistant.getByLabel('AI response')).toHaveCount(0);
  if (!live) {
    await page.unroute('**/api/ai/chat');
    await page.route('**/api/ai/chat', route => route.fulfill({ status: 429, json: { detail: 'AI provider rate limit reached. Try again later.' } }));
    await input.fill('Retry this message');
    await assistant.getByRole('button', { name: 'Ask Wireup', exact: true }).click();
    await expect(assistant.getByRole('alert')).toContainText('rate limit');
    await expect(input).toHaveValue('Retry this message');
    await page.unroute('**/api/ai/chat');
    await page.route('**/api/ai/chat', async route => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await route.fulfill({ json: { message: { role: 'assistant', content: 'A cancelled response must not appear.' }, model: 'browser-test' } }).catch(() => {});
    });
    await assistant.getByRole('button', { name: 'Ask Wireup', exact: true }).click();
    await assistant.getByRole('button', { name: 'Cancel request' }).click();
    await expect(assistant.getByRole('status')).toContainText('cancelled');
    await expect(input).toHaveValue('Retry this message');
    await expect(assistant.getByLabel('AI response')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Blink an LED', exact: true }).click();
  await page.waitForURL('**/editor');
  const dock = page.locator('.wu-assistant');
  await dock.getByLabel('What would you like to build or fix?').fill('Explain an LED resistor.');
  if (!live) {
    await page.unroute('**/api/ai/chat');
    await page.route('**/api/ai/chat', route => route.fulfill({ json: { message: { role: 'assistant', content: 'Use a current-limiting resistor.' }, model: 'browser-test' } }));
  }
  const before = await page.evaluate(() => JSON.stringify({ files: window.__velxioStores.useEditorStore.getState().files, components: window.__velxioStores.useSimulatorStore.getState().components, wires: window.__velxioStores.useSimulatorStore.getState().wires }));
  await dock.getByRole('button', { name: 'Ask Wireup', exact: true }).click();
  await expect(dock.getByLabel('AI response')).toBeVisible({ timeout: 95000 });
  expect(await page.evaluate(() => JSON.stringify({ files: window.__velxioStores.useEditorStore.getState().files, components: window.__velxioStores.useSimulatorStore.getState().components, wires: window.__velxioStores.useSimulatorStore.getState().wires }))).toBe(before);
  await page.getByRole('button', { name: /Schematic/ }).click();
  await expect(dock.getByLabel('AI response')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dock.getByLabel('AI response')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  console.log(live ? 'PASS live provider chat: real responses rendered on home/editor.' : 'PASS mocked transport chat UI: conversation, follow-up, clear, errors, cancel, unchanged project, schematic/mobile. Live model calls were not verified.');
} finally { await browser.close(); }
