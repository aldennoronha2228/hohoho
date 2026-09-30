// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasCommand } from '../../store/useSimulatorStore';
import type { Wire } from '../../types/wire';

vi.mock('../../store/useEditorStore', async () => {
  const { create } = await import('zustand');
  const initial = [{ id: 'f1', name: 'sketch.ino', content: 'before', modified: false }];
  const store = create(() => ({
    activeGroupId: 'g1',
    files: initial,
    fileGroups: { g1: initial },
    codeChangedSinceLastCompile: false,
    setFileContent(id: string, content: string) {
      const state = store.getState();
      const files = state.files.map((file) =>
        file.id === id ? { ...file, content, modified: true } : file,
      );
      store.setState({ files, fileGroups: { g1: files }, codeChangedSinceLastCompile: true });
    },
    updateGroupFile: vi.fn(),
  }));
  return { useEditorStore: store };
});
vi.mock('../../store/useSimulatorStore', async () => {
  const { create } = await import('zustand');
  const store = create(() => ({
    activeBoardId: 'uno',
    running: false,
    boards: [
      {
        id: 'uno',
        boardKind: 'arduino-uno',
        x: 10,
        y: 20,
        activeFileGroupId: 'g1',
        languageMode: 'arduino',
        libraries: [],
        running: false,
      },
    ],
    components: [{ id: 'led', metadataId: 'led', x: 100, y: 100, properties: {} }],
    wires: [] as Wire[],
    history: [] as CanvasCommand[],
    historyIndex: -1,
    addWire(wire: Wire) {
      store.setState({ wires: [...store.getState().wires, wire] });
    },
    removeWire(id: string) {
      store.setState({ wires: store.getState().wires.filter((wire) => wire.id !== id) });
    },
    pushCommand(command: CanvasCommand) {
      command.execute();
      store.setState({ history: [command], historyIndex: 0 });
    },
    undo() {
      const state = store.getState();
      state.history[state.historyIndex].undo();
      store.setState({ historyIndex: state.historyIndex - 1 });
    },
  }));
  return { useSimulatorStore: store };
});
vi.mock('../../store/useProjectStore', async () => {
  const { create } = await import('zustand');
  return { useProjectStore: create(() => ({ currentProject: null, currentExampleId: null })) };
});
vi.mock('../project', async () => {
  const { create } = await import('zustand');
  return { useWireupProject: create(() => ({ project: null as { id: string } | null })) };
});

import { useEditorStore } from '../../store/useEditorStore';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { useWireupProject } from '../project';
import { applyAIProposal, captureAIProject, getProjectRevision } from '../assistantProject';
import { requestAIProposal, type AIProposal } from '../aiClient';

function proposal(): AIProposal {
  return {
    revision: getProjectRevision(),
    explanation: 'Review resistor and polarity.',
    files: [{ op: 'set_file', group_id: 'g1', name: 'sketch.ino', content: 'after' }],
    circuit: [
      {
        op: 'add_wire',
        start: { component_id: 'uno', pin_name: '13' },
        end: { component_id: 'led', pin_name: 'A' },
        color: '#22c55e',
      },
    ],
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '<div id="uno"></div><div id="led"></div>';
  Object.assign(document.getElementById('uno')!, { pinInfo: [{ name: '13', x: 4, y: 8 }] });
  Object.assign(document.getElementById('led')!, { pinInfo: [{ name: 'A', x: 2, y: 3 }] });
  const files = [{ id: 'f1', name: 'sketch.ino', content: 'before', modified: false }];
  useEditorStore.setState({ files, fileGroups: { g1: files }, activeGroupId: 'g1' });
  useSimulatorStore.setState({ wires: [], running: false, history: [], historyIndex: -1 });
});

describe('guarded assistant project edits', () => {
  it('captures exact rendered pins and current firmware', () => {
    const context = captureAIProject();
    expect(context.components.find((part) => part.id === 'led')?.pins).toEqual(['A']);
    expect(context.files[0].content).toBe('before');
  });
  it('applies code and circuit as one undo command with real pin coordinates', () => {
    const applied = applyAIProposal(proposal());
    expect(useEditorStore.getState().files[0].content).toBe('after');
    expect(useEditorStore.getState().codeChangedSinceLastCompile).toBe(true);
    expect(useSimulatorStore.getState().wires[0].start).toMatchObject({ x: 14, y: 28 });
    expect(useSimulatorStore.getState().wires[0].end).toMatchObject({ x: 108, y: 109 });
    expect(applied.canUndo()).toBe(true);
    applied.undo();
    expect(useEditorStore.getState().files[0].content).toBe('before');
    expect(useSimulatorStore.getState().wires).toHaveLength(0);
  });
  it('rejects stale proposals including change-and-revert revisions', () => {
    const pending = proposal();
    useEditorStore.getState().setFileContent('f1', 'newer');
    useEditorStore.getState().setFileContent('f1', 'before');
    expect(() => applyAIProposal(pending)).toThrow('Project changed');
  });
  it('refuses undo over a newer user edit', () => {
    const applied = applyAIProposal(proposal());
    useEditorStore.getState().setFileContent('f1', 'user edit');
    expect(applied.canUndo()).toBe(false);
    expect(() => applied.undo()).toThrow('Project changed');
    expect(useEditorStore.getState().files[0].content).toBe('user edit');
  });
  it('validates all pins before mutating any file', () => {
    const invalid = proposal();
    if (invalid.circuit[0].op === 'add_wire') invalid.circuit[0].end.pin_name = 'invented';
    expect(() => applyAIProposal(invalid)).toThrow('not rendered');
    expect(useEditorStore.getState().files[0].content).toBe('before');
  });
  it('blocks apply while simulation is running', () => {
    useSimulatorStore.setState({ running: true });
    expect(() => applyAIProposal(proposal())).toThrow('Stop all simulations');
  });
  it('invalidates proposals when the Wireup project identity changes', () => {
    const pending = proposal();
    useWireupProject.setState({ project: { id: 'other-project' } as never });
    expect(() => applyAIProposal(pending)).toThrow('Project changed');
  });
});

describe('AI HTTP client', () => {
  it('passes cancellation through to the real request', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Cancelled', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const request = requestAIProposal('fix', captureAIProject(), controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it('surfaces actionable backend configuration errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: 'Set WIREUP_AI_API_KEY on the backend.' }), {
            status: 503,
          }),
      ),
    );
    await expect(
      requestAIProposal('fix', captureAIProject(), new AbortController().signal),
    ).rejects.toThrow('WIREUP_AI_API_KEY');
  });
  it('rejects malformed provider response shapes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ explanation: 'fake success' }))),
    );
    await expect(
      requestAIProposal('fix', captureAIProject(), new AbortController().signal),
    ).rejects.toThrow();
  });
});
