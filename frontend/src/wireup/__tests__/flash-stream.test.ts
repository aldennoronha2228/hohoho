import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamFlash } from '../../services/flashService';
afterEach(() => vi.unstubAllGlobals());
const request = { boardId: 'board', port: 'COM3', fqbn: 'arduino:avr:uno', programFormat: 'hex' as const, programData: ':00000001FF' };
describe('hardware upload completion evidence', () => {
  it('reports an incomplete stream as failed rather than leaving upload running', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data: {"phase":"writing","line":"Uploading"}\n\n')));
    const events = [];
    for await (const event of streamFlash(request)) events.push(event);
    expect(events.at(-1)).toMatchObject({ phase: 'done', success: false, error: expect.stringContaining('not confirmed') });
  });
  it('preserves a real terminal success without adding a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data: {"phase":"done","success":true,"elapsed_ms":100}\n\n')));
    const events = [];
    for await (const event of streamFlash(request)) events.push(event);
    expect(events).toEqual([{ phase: 'done', success: true, elapsed_ms: 100 }]);
  });
});
