import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const live = process.env.WIREUP_CHAT_LIVE === '1';
let requests = 0;
try {
  if (!live) {
    await page.route('**/api/ai/chat/status', route => route.fulfill({ json: { configured: true, model: 'test', message: 'Test settings' } }));
    await page.route('**/api/ai/chat/questions', route => route.fulfill({ json: { model: 'test', questions: Array.from({ length: 10 }, (_, index) => ({ id: `q${index}`, question: `LED project choice ${index + 1}`, options: [{ id: 'a', label: 'Use requested behavior' }, { id: 'b', label: 'Use alternative behavior' }, { id: 'c', label: 'Choose for me' }] })) } }));
    await page.route('**/api/ai/chat/turn', route => {
      requests++;
      const messages = route.request().postDataJSON().messages;
      if (messages.at(-1).role === 'tool') return route.fulfill({ json: { model: 'test', message: { role: 'assistant', content: 'Actual project inspection completed.' } } });
      expect(messages[0].content).toContain('Project-specific answers:');
      return route.fulfill({ json: { model: 'test', message: { role: 'assistant', tool_calls: [{ id: 'inspect', type: 'function', function: { name: 'get_project_state', arguments: '{}' } }], content: null } } });
    });
  }
  await page.goto('http://localhost:5173');
  const input = page.locator('.wu-home-assistant').getByLabel('What would you like to build or fix?');
  await input.fill('Build an Arduino LED blink project using the current board built-in LED (pin 13). Write firmware that prints "Wireup live generation" to Serial, compile and run. Do not search or add external parts for this built-in LED test. Inspect current project first, use exact file ID.');
  await expect(page.locator('.wu-home-assistant').getByRole('button', { name: 'Ask Wireup', exact: true })).toBeEnabled();
  await input.press('Enter');
  await page.waitForURL('**/build');
  await expect(page.getByRole('heading', { name: 'Set up your build' })).toBeVisible();
  await page.getByRole('button', { name: 'Prepare project questions' }).click();
  await expect(page.locator('.wu-build-questions fieldset')).toHaveCount(10, { timeout: 95000 });
  for (const fieldset of await page.locator('.wu-build-questions fieldset').all()) await fieldset.locator('input[type=radio]').first().check();
  await page.getByRole('button', { name: 'Start generating' }).click();
  const chat = page.locator('.wu-build-chat');
  const deadline = Date.now() + 600000;
  while (await chat.getByRole('button', { name: 'Cancel request' }).count() || !(await chat.getByLabel('AI response').count()) || await chat.getByRole('button', { name: 'Resume build' }).count()) {
    const allow = chat.getByRole('button', { name: 'Allow change', exact: true });
    if (await allow.isVisible()) await allow.click();
    const resume = chat.getByRole('button', { name: 'Resume build' });
    if (live && await resume.isVisible()) { await page.waitForTimeout(30000); await resume.click(); }
    if (Date.now() > deadline) throw new Error('Build page did not finish within deadline.');
    await page.waitForTimeout(200);
    if (!live && requests >= 2 && !(await chat.getByRole('button', { name: 'Cancel request' }).count())) break;
  }
  console.log('FINAL CHAT', (await chat.innerText()).slice(-12000));
  if (live) {
    const firmware = await page.evaluate(async () => (await import('/src/wireup/tools/index.ts')).get_firmware());
    expect(firmware.data.files.some(file => file.content.includes('Wireup live generation'))).toBe(true);
    const build = await page.evaluate(async () => (await import('/src/wireup/tools/index.ts')).get_build_result());
    expect(build.data.compilation_result.success).toBe(true);
    expect(build.data.simulation_result.last_start.success).toBe(true);
    expect(build.data.simulation_result.serial_output.some(board => board.output.includes('Wireup live generation'))).toBe(true);
    await page.evaluate(async () => (await import('/src/wireup/tools/index.ts')).stop_simulation());
  }
  if (!live) {
    await page.reload();
    await page.getByRole('button', { name: 'Open saved conversation' }).click();
    await expect(page.locator('.wu-build-chat')).toContainText('Actual project inspection completed.');
    await page.getByRole('link', { name: 'History', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Build history' })).toBeVisible();
    await page.locator('.wu-build-questions li button').first().click();
    await page.getByRole('button', { name: 'Open saved conversation' }).click();
    await expect(page.locator('.wu-build-chat')).toContainText('Actual project inspection completed.');
  }
  await page.getByRole('button', { name: 'Circuit & firmware' }).click();
  await expect(page.locator('.wu-live-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await expect(chat).toBeVisible();
  await page.screenshot({ path: `artifacts/build-conversation-${live ? 'live' : 'test'}.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.wu-header .wu-theme-toggle').click();
  await expect(chat).toBeVisible();
  console.log(live ? 'PASS LIVE model generated firmware, compiled and ran the existing simulator through build questions/conversation.' : 'PASS build questions, actual tool inspection, conversation, circuit view, mobile and theme. Model response fixture used.');
} catch (error) { console.log('BUILD PAGE ERROR', String(error), await page.locator('body').innerText()); throw error; } finally { await browser.close(); }
