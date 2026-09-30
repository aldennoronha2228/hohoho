import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
fs.mkdirSync('artifacts', { recursive: true });
const root = 'http://127.0.0.1:5173';
async function theme(mode) {
  const current = await page.locator('html').getAttribute('data-theme');
  if (current !== mode) await page.locator('.wu-header .wu-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
  expect(await page.evaluate(() => localStorage.getItem('velxio-theme'))).toBe(mode);
  const palette = await page.locator('.wireup-shell').evaluate(element => ({ bg: getComputedStyle(element).backgroundColor, fg: getComputedStyle(element).color }));
  expect(palette.bg).toBe(mode === 'light' ? 'rgb(245, 244, 241)' : 'rgb(23, 23, 21)');
  expect(palette.fg).toBe(mode === 'light' ? 'rgb(41, 43, 45)' : 'rgb(240, 239, 235)');
}
async function fits() {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
try {
  await page.goto(root);
  await expect(page.getByRole('heading', { name: 'Build something extraordinary.' })).toBeVisible();
  for (const mode of ['light', 'dark']) {
    await theme(mode);
    await page.screenshot({ path: `artifacts/workbench-${mode}.png` });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    await page.getByRole('button', { name: 'Blink an LED', exact: true }).click();
    await page.waitForURL('**/editor');
    await theme(mode);
    await expect(page.locator('.wu-live-canvas')).toBeVisible();
    await expect(page.locator('.wu-ai-panel')).toBeVisible();
    const assistantBg = await page.locator('.wu-ai-composer').evaluate(element => getComputedStyle(element).backgroundColor);
    expect(assistantBg).toBe(mode === 'light' ? 'rgb(255, 255, 255)' : 'rgb(32, 32, 30)');
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30000 });
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText(`// Theme ${mode} verification`);
    await expect.poll(() => page.evaluate(() => window.__velxioStores.useEditorStore.getState().files.some(file => file.content.includes('Theme ')))).toBe(true);
    await page.getByTitle('Save project (Ctrl+S)', { exact: true }).click();
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('button', { name: /Schematic/ }).click();
    await expect(page.locator('.wu-schematic-symbol')).not.toHaveCount(0);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Fit circuit to view' }).click();
    const ink = await page.locator('.wu-schematic-part-label').first().evaluate(element => getComputedStyle(element).fill);
    expect(ink).toBe(mode === 'light' ? 'rgb(41, 43, 45)' : 'rgb(240, 239, 235)');
    await page.screenshot({ path: `artifacts/editor-${mode}.png` });
    await page.getByRole('link', { name: 'Build pack', exact: true }).click();
    await expect(page.locator('.wu-prototype-summary')).toBeVisible();
    await page.getByRole('button', { name: /Wiring/, exact: false }).first().click();
    await page.getByRole('button', { name: /Assembly/, exact: false }).first().click();
    await page.screenshot({ path: `artifacts/build-pack-${mode}.png` });
    await page.locator('.wu-header').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'About Wireup' })).toBeVisible();
    await page.keyboard.press('Escape');
    for (const route of ['/examples', '/examples/blink-led', '/example/blink-led', '/es/', '/es/editor', '/es/prototype']) {
      await page.goto(root + route);
      await expect(page.locator('.wu-main')).not.toBeEmpty();
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await fits();
    }
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const route of ['/', '/editor', '/prototype', '/examples']) {
        await page.goto(root + route);
        await fits();
        await theme(mode);
        if (route === '/') {
          await page.getByRole('button', { name: 'Toggle navigation' }).click();
          await page.getByRole('link', { name: 'Projects', exact: true }).click();
          await expect(page.locator('#projects')).toBeInViewport();
        }
        if (route === '/editor') {
          const close = page.getByRole('button', { name: 'Close assistant' });
          if (await close.isVisible()) await close.click();
          await page.getByRole('button', { name: 'Circuit', exact: true }).click();
          await expect(page.locator('.wu-live-canvas')).toBeVisible();
          await page.getByRole('button', { name: /Schematic/ }).click();
          await expect(page.locator('.wu-schematic')).toBeVisible();
        }
        if (width === 390) await page.screenshot({ path: `artifacts/theme-${mode}-${route === '/' ? 'home' : route.slice(1)}-mobile.png` });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(root);
  }
  expect(errors).toEqual([]);
  console.log('PASS light/dark persistence, editing, shared routes, schematic, build pack and desktop/mobile flows. PAGE_ERRORS', errors);
} finally { await browser.close(); }
