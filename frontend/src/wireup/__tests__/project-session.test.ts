// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

const storage = vi.hoisted(() => ({
  projects: {} as Record<string, unknown>,
  read: undefined as Promise<Record<string, unknown>> | undefined,
  write: undefined as Promise<void> | undefined,
  fail: false,
}));
vi.mock('idb-keyval', () => ({
  createStore: vi.fn(),
  get: () => storage.read ?? Promise.resolve(structuredClone(storage.projects)),
  update: async (_key: string, operation: (current: Record<string, unknown>) => Record<string, unknown>) => {
    if (storage.write) await storage.write;
    if (storage.fail) throw new Error('Storage unavailable');
    storage.projects = structuredClone(operation(storage.projects));
  },
}));
vi.mock('../../store/useEditorStore', () => ({ useEditorStore: createStore(() => ({
  fileGroups: { group: [{ id: 'main', name: 'sketch.ino', content: 'initial', modified: false }] },
  folderGroups: {}, activeGroupId: 'group', activeGroupFileId: { group: 'main' }, openGroupFileIds: { group: ['main'] },
})) }));
vi.mock('../../store/useSimulatorStore', () => ({ useSimulatorStore: createStore(() => ({
  boards: [{ id: 'uno', boardKind: 'arduino-uno', x: 0, y: 0, activeFileGroupId: 'group', serialBaudRate: 115200 }],
  components: [], wires: [], activeBoardId: 'uno',
  loadProjectState: vi.fn(), updateBoard: vi.fn(), setActiveBoardId: vi.fn(),
})) }));
vi.mock('../../store/useVfsStore', () => ({ useVfsStore: createStore(() => ({ boards: {}, selectedNodeId: {} })) }));
vi.mock('../../store/useElectricalStore', () => ({ useElectricalStore: createStore(() => ({ reset: vi.fn(), setPaused: vi.fn() })) }));
vi.mock('../../store/useProjectStore', () => {
  const store = createStore<{ currentProject: unknown; currentExampleId: string | null; clearCurrentProject: () => void }>(() => ({
    currentProject: null, currentExampleId: null,
    clearCurrentProject: () => store.setState({ currentProject: null, currentExampleId: null }),
  }));
  return { useProjectStore: store };
});
vi.mock('../../utils/vlxFile', () => ({
  buildVlxPayload: () => {
    const state = useSimulatorStore.getState();
    return { format: 'velxio-project', version: 1, exportedAt: new Date().toISOString(), boards: state.boards, components: state.components, wires: state.wires, activeBoardId: state.activeBoardId };
  },
  parseVlxFile: vi.fn(),
}));
vi.mock('../../utils/projectPayload', () => ({ buildSavePayload: () => ({ boards_json: JSON.stringify(useSimulatorStore.getState().boards) }) }));
vi.mock('../../utils/loadExample', () => ({ loadExample: vi.fn() }));

import { useEditorStore } from '../../store/useEditorStore';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { useProjectStore } from '../../store/useProjectStore';
import { loadExample } from '../../utils/loadExample';
import type { ExampleProject } from '../../data/examples';
import {
  captureProjectSnapshot, createProject, createProjectFromExample, deleteProject, detachProject,
  loadProject, openProject, restoreProjectSnapshot, saveCurrentProject, saveProject,
  startProjectAutosave, useWireupProject,
} from '../project';

const key = 'wireup-active-project';
function edit(content: string) {
  const state = useEditorStore.getState();
  useEditorStore.setState({ fileGroups: { ...state.fileGroups, group: state.fileGroups.group.map((file) => ({ ...file, content })) } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
let autosave: ReturnType<typeof startProjectAutosave> | undefined;

beforeEach(() => {
  detachProject();
  storage.projects = {}; storage.read = undefined; storage.write = undefined; storage.fail = false;
  localStorage.clear();
  vi.clearAllMocks();
  useWireupProject.setState({ saving: false });
  useProjectStore.setState({ currentProject: null, currentExampleId: null });
  edit('initial');
});
afterEach(() => { autosave?.dispose(); autosave = undefined; vi.useRealTimers(); });

describe('local active-project lifecycle', () => {
  it('remembers the first save and reopens its saved snapshot', async () => {
    const saved = await saveCurrentProject('Bench');
    expect(localStorage.getItem(key)).toBe(saved.id);
    detachProject();
    edit('other workspace');
    await openProject(saved.id);
    expect(useEditorStore.getState().fileGroups.group[0].content).toBe('initial');
    expect(useWireupProject.getState()).toMatchObject({ project: { id: saved.id }, dirty: false });
    expect(localStorage.getItem(key)).toBe(saved.id);
    expect(useSimulatorStore.getState().updateBoard).toHaveBeenCalledWith('uno', expect.objectContaining({ activeFileGroupId: 'group', serialBaudRate: 115200 }));
  });

  it('detaches without deleting the saved project or changing the workspace', async () => {
    const saved = await saveCurrentProject();
    edit('unsaved');
    detachProject();
    expect(localStorage.getItem(key)).toBeNull();
    expect(useWireupProject.getState().project).toBeNull();
    expect(useEditorStore.getState().fileGroups.group[0].content).toBe('unsaved');
    expect((await loadProject(saved.id)).snapshot.editor.fileGroups.group[0].content).toBe('initial');
  });

  it('deletes a restore hint even when no in-memory project is active', async () => {
    const saved = await saveProject(createProject());
    localStorage.setItem(key, saved.id);
    await deleteProject(saved.id);
    expect(localStorage.getItem(key)).toBeNull();
    await expect(loadProject(saved.id)).rejects.toThrow('Project not found');
  });

  it('keeps the current session and restore hint if deletion fails', async () => {
    const saved = await saveCurrentProject();
    storage.fail = true;
    await expect(deleteProject(saved.id)).rejects.toThrow('Storage unavailable');
    expect(useWireupProject.getState().project?.id).toBe(saved.id);
    expect(localStorage.getItem(key)).toBe(saved.id);
  });

  it('blocks autosave and explicit saves while deletion is awaiting storage', async () => {
    vi.useFakeTimers();
    const saved = await saveCurrentProject();
    autosave = startProjectAutosave(20);
    edit('changed');
    const pending = deferred<void>();
    storage.write = pending.promise;
    const deleting = deleteProject(saved.id);
    await expect(saveCurrentProject()).rejects.toThrow('deletion is in progress');
    edit('changed during deletion');
    await vi.advanceTimersByTimeAsync(40);
    pending.resolve();
    await deleting;
    expect(Object.keys(storage.projects)).toEqual([]);
    expect(useWireupProject.getState().project).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('does not clear an unrelated restore hint when deleting another project', async () => {
    const active = await saveCurrentProject();
    const other = await saveProject(createProject());
    await deleteProject(other.id);
    expect(localStorage.getItem(key)).toBe(active.id);
  });

  it.each(['detach', 'delete', 'restore'] as const)('does not recreate a project from a pending autosave after %s', async (action) => {
    vi.useFakeTimers();
    const saved = await saveCurrentProject();
    autosave = startProjectAutosave(20);
    const snapshot = captureProjectSnapshot();
    edit('changed');
    expect(useWireupProject.getState().dirty).toBe(true);
    if (action === 'detach') detachProject();
    else if (action === 'delete') await deleteProject(saved.id);
    else restoreProjectSnapshot(snapshot);
    await vi.advanceTimersByTimeAsync(40);
    expect(useWireupProject.getState().project).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    expect(Object.keys(storage.projects)).toEqual(action === 'delete' ? [] : [saved.id]);
  });

  it('does not save a newly opened project using the previous session timer', async () => {
    vi.useFakeTimers();
    await saveCurrentProject();
    autosave = startProjectAutosave(20);
    edit('changed');
    const other = await saveProject(createProject('Other'));
    await openProject(other.id);
    storage.fail = true;
    await vi.advanceTimersByTimeAsync(40);
    expect(useWireupProject.getState()).toMatchObject({ project: { id: other.id }, dirty: false, error: null });
  });

  it('ignores an in-flight save completion after detaching', async () => {
    const pending = deferred<void>();
    storage.write = pending.promise;
    const saving = saveCurrentProject();
    detachProject();
    pending.resolve();
    await saving;
    expect(useWireupProject.getState()).toMatchObject({ project: null, saving: false });
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('refuses a delayed open after detaching', async () => {
    const saved = await saveProject(createProject());
    const pending = deferred<Record<string, unknown>>();
    storage.read = pending.promise;
    const opening = openProject(saved.id);
    detachProject();
    pending.resolve(storage.projects);
    await expect(opening).rejects.toThrow('superseded');
    expect(useSimulatorStore.getState().loadProjectState).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('does not activate a deleted project from a delayed read', async () => {
    const saved = await saveProject(createProject());
    const pending = deferred<Record<string, unknown>>();
    const beforeDeletion = structuredClone(storage.projects);
    storage.read = pending.promise;
    const opening = openProject(saved.id);
    await deleteProject(saved.id);
    pending.resolve(beforeDeletion);
    await expect(opening).rejects.toThrow('superseded');
    expect(useWireupProject.getState().project).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('keeps the newer open when reads complete out of order', async () => {
    const first = await saveProject(createProject('First'));
    const second = await saveProject(createProject('Second'));
    const pending = deferred<Record<string, unknown>>();
    storage.read = pending.promise;
    const opening = openProject(first.id);
    storage.read = undefined;
    await openProject(second.id);
    pending.resolve(storage.projects);
    await expect(opening).rejects.toThrow('superseded');
    expect(useWireupProject.getState().project?.id).toBe(second.id);
    expect(localStorage.getItem(key)).toBe(second.id);
  });

  it('preserves session, dirty state, and restore hint when snapshot application fails', async () => {
    const saved = await saveCurrentProject();
    autosave = startProjectAutosave();
    edit('unsaved');
    const previous = captureProjectSnapshot();
    vi.mocked(useSimulatorStore.getState().loadProjectState).mockImplementationOnce(() => { throw new Error('Apply failed'); });
    expect(() => restoreProjectSnapshot(saved.snapshot)).toThrow('Apply failed');
    expect(captureProjectSnapshot().editor).toEqual(previous.editor);
    expect(useWireupProject.getState()).toMatchObject({ project: { id: saved.id }, dirty: true });
    expect(localStorage.getItem(key)).toBe(saved.id);
  });

  it('restores the original session and restore hint after a failed template load', async () => {
    const saved = await saveCurrentProject();
    vi.mocked(loadExample).mockRejectedValueOnce(new Error('Template failed'));
    await expect(createProjectFromExample({ title: 'Template' } as ExampleProject)).rejects.toThrow('Template failed');
    expect(useWireupProject.getState()).toMatchObject({ project: { id: saved.id }, dirty: false, saving: false });
    expect(localStorage.getItem(key)).toBe(saved.id);
  });

  it('still saves and activates when localStorage is unavailable', async () => {
    const setter = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    try {
      const saved = await saveCurrentProject();
      expect(useWireupProject.getState()).toMatchObject({ project: { id: saved.id }, error: null });
      expect(await loadProject(saved.id)).toEqual(saved);
    } finally { setter.mockRestore(); }
  });
});
