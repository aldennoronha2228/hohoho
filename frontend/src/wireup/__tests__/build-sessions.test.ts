// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

const storage = vi.hoisted(() => ({ rows: new Map<string, unknown>(), fail: false }));
vi.mock('idb-keyval', () => ({
  createStore: vi.fn(() => ({})),
  get: async (id: string) => {
    if (storage.fail) throw new Error('Storage unavailable');
    return structuredClone(storage.rows.get(id));
  },
  update: async (id: string, operation: (current: unknown) => unknown) => {
    if (storage.fail) throw new Error('Storage unavailable');
    storage.rows.set(id, structuredClone(operation(structuredClone(storage.rows.get(id)))));
  },
  entries: async () => [...storage.rows.entries()].map(([id, value]) => [id, structuredClone(value)]),
  del: async (id: string) => { storage.rows.delete(id); },
}));
vi.mock('../project', () => ({
  useWireupProject: create<{ project: { id: string; name: string } | null }>(() => ({ project: null })),
  saveCurrentProject: vi.fn(), openProject: vi.fn(),
}));
vi.mock('../../pages/EditorPage', () => ({ EditorPage: () => null }));
vi.mock('../Assistant', () => ({ Assistant: () => 'Generation mounted' }));
vi.mock('../pendingChat', () => ({ takeBuildPrompt: () => null }));
vi.mock('../buildQuestions', async importOriginal => {
  const original = await importOriginal<typeof import('../buildQuestions')>();
  return { ...original, getBuildQuestions: async () => ({ model: 'test', questions: Array.from({ length: 10 }, (_, index) => ({ id: `q${index}`, question: `Project question ${index}`, options: [{ id: 'a', label: 'Requested choice' }, { id: 'b', label: 'Alternative' }, { id: 'c', label: 'Choose for me' }] })) }) };
});

import { openProject, saveCurrentProject, useWireupProject } from '../project';
import {
  BUILD_SESSION_MAX_BYTES, buildProjectName, currentBuildProjectId, deleteBuildSession,
  listBuildSessions, loadBuildSession, openBuildSession, prepareBuildSession,
  saveBuildSession, saveCurrentBuildSession, validateBuildSession,
} from '../buildSessions';
import { BuildConversation } from '../BuildConversation';
import { createElement } from 'react';

const setProject = (id: string, name = 'Existing bench') => useWireupProject.setState({ project: { id, name } as never });
const messages = [
  { role: 'user' as const, content: 'Blink the existing LED' },
  { role: 'assistant' as const, content: null, tool_calls: [{ id: 'call', type: 'function' as const, function: { name: 'get_project_state', arguments: '{}' } }] },
  { role: 'tool' as const, content: '{"success":true}', tool_call_id: 'call' },
  { role: 'assistant' as const, content: 'Ready for review.' },
];
const activities = [{ id: 'call', name: 'get_project_state', args: {}, status: 'success' as const, result: { success: true as const, data: { board: 'uno' } } }];
let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeEach(() => {
  storage.rows.clear(); storage.fail = false;
  vi.clearAllMocks();
  useWireupProject.setState({ project: null });
  vi.mocked(saveCurrentProject).mockImplementation(async name => {
    const existing = useWireupProject.getState().project;
    setProject(existing?.id ?? 'new-project', name ?? existing?.name ?? 'Untitled');
    return useWireupProject.getState().project! as Awaited<ReturnType<typeof saveCurrentProject>>;
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove(); root = undefined; container = undefined;
});

describe('per-project local build sessions', () => {
  it('round-trips full messages, tool call IDs, activity, and draft without changing the editor', async () => {
    const saved = await saveBuildSession('one', { draft: 'Blink', messages, activities });
    expect(saved).toMatchObject({ version: 1, projectId: 'one', draft: 'Blink', messages, activities });
    expect(await loadBuildSession('one')).toEqual(saved);
    expect(openProject).not.toHaveBeenCalled();
    expect(saveCurrentProject).not.toHaveBeenCalled();
    messages[0].content = 'changed in memory';
    expect((await loadBuildSession('one'))?.messages[0].content).toBe('Blink the existing LED');
    messages[0].content = 'Blink the existing LED';
  });

  it('preserves history and creation date during a draft-only update', async () => {
    const first = await saveBuildSession('one', { messages, activities });
    const next = await saveBuildSession('one', { draft: 'Next change' });
    expect(next).toMatchObject({ createdAt: first.createdAt, draft: 'Next change', messages, activities });
    await saveBuildSession('one', { messages: [], activities: [] });
    expect(await loadBuildSession('one')).toMatchObject({ draft: 'Next change', messages: [], activities: [] });
  });

  it('isolates project sessions and supports the active project', async () => {
    await saveBuildSession('one', { draft: 'First' });
    setProject('two');
    expect(currentBuildProjectId()).toBe('two');
    expect(await loadBuildSession()).toBeNull();
    await saveCurrentBuildSession({ draft: 'Second' });
    expect((await loadBuildSession())?.draft).toBe('Second');
    expect((await loadBuildSession('one'))?.draft).toBe('First');
    useWireupProject.setState({ project: null });
    await expect(loadBuildSession()).rejects.toThrow('Save or open');
  });

  it('survives module reload and returns bounded history summaries newest first', async () => {
    await saveBuildSession('one', { draft: 'First', messages });
    await saveBuildSession('two', { draft: 'Second', activities });
    const one = await loadBuildSession('one');
    storage.rows.set('one', { ...one, updatedAt: '2025-01-01T00:00:00.000Z' });
    vi.resetModules();
    const reloaded = await import('../buildSessions');
    expect((await reloaded.loadBuildSession('one'))?.messages).toEqual(messages);
    expect(await reloaded.listBuildSessions()).toEqual([
      expect.objectContaining({ projectId: 'two', messageCount: 0, activityCount: 1 }),
      expect.objectContaining({ projectId: 'one', draft: 'First', messageCount: 4, activityCount: 0 }),
    ]);
    expect((await listBuildSessions())[0]).not.toHaveProperty('messages');
  });

  it('opens the existing local project only on explicit history navigation', async () => {
    await saveBuildSession('one', { draft: 'Saved' });
    expect((await openBuildSession('one'))?.draft).toBe('Saved');
    expect(openProject).toHaveBeenCalledWith('one');
    await deleteBuildSession('one');
    expect(await loadBuildSession('one')).toBeNull();
    expect(saveCurrentProject).not.toHaveBeenCalled();
  });

  it('rejects invalid stored identity and version before opening a workspace', async () => {
    const saved = await saveBuildSession('one', {});
    storage.rows.set('one', { ...saved, projectId: 'other' });
    await expect(openBuildSession('one')).rejects.toThrow('does not match');
    expect(openProject).not.toHaveBeenCalled();
    storage.rows.set('one', { ...saved, version: 2 });
    await expect(loadBuildSession('one')).rejects.toThrow();
  });

  it.each(['', '__proto__', 'constructor', 'prototype', 'x'.repeat(257)])('rejects invalid project IDs', async id => {
    await expect(saveBuildSession(id, {})).rejects.toThrow();
    expect(storage.rows.size).toBe(0);
  });

  it('bounds drafts, messages, activities, total bytes, and JSON nesting', async () => {
    await expect(saveBuildSession('one', { draft: 'x'.repeat(8001) })).rejects.toThrow();
    await expect(saveBuildSession('one', { messages: Array(129).fill(messages[0]) })).rejects.toThrow();
    await expect(saveBuildSession('one', { activities: Array(257).fill(activities[0]) })).rejects.toThrow();
    await expect(saveBuildSession('one', { messages: Array(5).fill({ role: 'assistant', content: 'x'.repeat(524288) }) })).rejects.toThrow('too large');
    let nested: unknown = 'leaf';
    for (let i = 0; i < 22; i++) nested = { nested };
    await expect(saveBuildSession('one', { activities: [{ ...activities[0], args: { nested } }] })).rejects.toThrow();
    expect(storage.rows.size).toBe(0);
    expect(BUILD_SESSION_MAX_BYTES).toBe(2097152);
  });

  it('rejects configuration/API key fields instead of storing provider settings', async () => {
    await expect(saveBuildSession('one', { draft: '', apiKey: 'private' } as never)).rejects.toThrow();
    await expect(saveBuildSession('one', { activities: [{ ...activities[0], args: { nested: { api_key: 'private' } } }] })).rejects.toThrow();
    await expect(saveBuildSession('one', { activities: [{ ...activities[0], result: { success: true, data: { authorization: 'private' } } }] })).rejects.toThrow();
    const saved = await saveBuildSession('one', {});
    expect(() => validateBuildSession({ ...saved, provider: { apiKey: 'private' } })).toThrow();
    expect(JSON.stringify(await loadBuildSession('one'))).not.toContain('private');
  });

  it('propagates storage failures without replacing saved history', async () => {
    const saved = await saveBuildSession('one', { draft: 'Keep' });
    storage.fail = true;
    await expect(saveBuildSession('one', { draft: 'Lost' })).rejects.toThrow('Storage unavailable');
    await expect(loadBuildSession('one')).rejects.toThrow('Storage unavailable');
    storage.fail = false;
    expect(await loadBuildSession('one')).toEqual(saved);
  });
});

describe('save-before-generation bootstrap', () => {
  it('uses a meaningful capped request name and never opens/replaces the circuit', async () => {
    const request = '  Make an LED\n blink once per second using the current Arduino Uno and existing parts.  ';
    const session = await prepareBuildSession(request);
    expect(saveCurrentProject).toHaveBeenCalledWith(buildProjectName(request));
    expect(buildProjectName(request).length).toBeLessThanOrEqual(80);
    expect(session).toMatchObject({ projectId: 'new-project', draft: request.trim() });
    expect(openProject).not.toHaveBeenCalled();
    expect(buildProjectName('x'.repeat(100))).toBe('x'.repeat(80));
  });

  it('preserves an existing project name and history when modifying it', async () => {
    setProject('existing', 'Temperature logger');
    await saveBuildSession('existing', { messages, activities });
    const session = await prepareBuildSession('Change the sampling rate');
    expect(saveCurrentProject).toHaveBeenCalledWith(undefined);
    expect(useWireupProject.getState().project?.name).toBe('Temperature logger');
    expect(session).toMatchObject({ projectId: 'existing', messages, activities, draft: 'Change the sampling rate' });
  });

  it('blocks bootstrap on project save failure or active project change', async () => {
    vi.mocked(saveCurrentProject).mockRejectedValueOnce(new Error('Disk full'));
    await expect(prepareBuildSession('Blink')).rejects.toThrow('Disk full');
    expect(storage.rows.size).toBe(0);
    vi.mocked(saveCurrentProject).mockResolvedValueOnce({ id: 'superseded' } as never);
    await expect(prepareBuildSession('Blink')).rejects.toThrow('active project changed');
    expect(storage.rows.size).toBe(0);
  });

  it('blocks bootstrap on session save failure, then retries without renaming the project', async () => {
    storage.fail = true;
    await expect(prepareBuildSession('Blink')).rejects.toThrow('Storage unavailable');
    storage.fail = false;
    expect((await prepareBuildSession('Blink'))).toMatchObject({ projectId: 'new-project', draft: 'Blink' });
    expect(saveCurrentProject).toHaveBeenLastCalledWith(undefined);
  });

  it('restores a saved request on remount without automatically generating', async () => {
    setProject('existing');
    await saveBuildSession('existing', { draft: 'Continue my LED build', messages, activities });
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(createElement(MemoryRouter, null, createElement(BuildConversation))); });
    expect(container.querySelector('textarea')?.value).toBe('Continue my LED build');
    expect(container.textContent).not.toContain('Generation mounted');
    expect(saveCurrentProject).not.toHaveBeenCalled();
  });

  it('shows save errors and does not mount generation until a successful retry', async () => {
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(createElement(MemoryRouter, null, createElement(BuildConversation))); });
    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Blink my existing LED');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { Array.from(container!.querySelectorAll('button')).find(button => button.textContent === 'Prepare project questions')!.click(); });
    for (const fieldset of container.querySelectorAll('fieldset')) await act(async () => { fieldset.querySelector<HTMLInputElement>('input')!.click(); });
    vi.mocked(saveCurrentProject).mockRejectedValueOnce(new Error('Disk full'));
    await act(async () => { container!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Disk full');
    expect(container.textContent).not.toContain('Generation mounted');
    expect(textarea.value).toBe('Blink my existing LED');
    await act(async () => { container!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(container.textContent).toContain('Generation mounted');
    expect((await loadBuildSession('new-project'))?.draft).toBe('Blink my existing LED');
  });
});
