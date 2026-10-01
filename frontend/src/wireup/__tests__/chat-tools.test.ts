// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runChatTurn } from '../chatClient';
import { executeWireupTool } from '../tools';
import { recordBuildOperation, currentBuildResult } from '../tools/buildResult';
import { useEditorStore } from '../../store/useEditorStore';
import { useSimulatorStore } from '../../store/useSimulatorStore';
vi.hoisted(() => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    if (args[0] === '/components-metadata.json') {
      const { readFileSync } = await import('node:fs');
      return new Response(readFileSync('public/components-metadata.json', 'utf8'));
    }
    return original(...args);
  }) as typeof fetch;
});
beforeEach(() => {
  useSimulatorStore.setState({ boards: [], components: [], wires: [], activeBoardId: null, running: false });
  const file = { id: 'firmware', name: 'sketch.ino', content: 'old', modified: false };
  useEditorStore.setState({ files: [file], fileGroups: { group: [file] }, activeGroupId: 'group', folderGroups: {}, activeGroupFileId: { group: 'firmware' }, openGroupFileIds: { group: ['firmware'] } });
});
describe('single model tool conversation with real adapters', () => {
  it('has loaded the real adapter without consuming a model response', async () => { expect((await executeWireupTool('get_firmware')).success).toBe(true); });
  it('executes a model function call and returns the actual firmware result to the next model turn', async () => {
    const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ model: 'test', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call1', type: 'function', function: { name: 'set_firmware', arguments: JSON.stringify({ file: 'firmware', content: 'void setup() {}\nvoid loop() {}' }) } }] } }))).mockResolvedValueOnce(new Response(JSON.stringify({ model: 'test', message: { role: 'assistant', content: 'Firmware updated.' } })));
    try {
      const progress = vi.fn();
      const result = await runChatTurn([{ role: 'user', content: 'Write firmware' }], new AbortController().signal, true, progress);
      expect(useEditorStore.getState().files[0].content).toBe('void setup() {}\nvoid loop() {}');
      const next = JSON.parse(transport.mock.calls[1][1]!.body as string);
      expect(JSON.parse(next.messages.at(-1).content)).toMatchObject({ success: true, data: { file: 'firmware' } });
      expect(result.messages.at(-1)?.content).toBe('Firmware updated.');
    } finally { transport.mockRestore(); }
  });
  it('returns actual errors to the model rather than claiming success', async () => {
    const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ model: 'test', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call1', type: 'function', function: { name: 'set_firmware', arguments: '{"file":"missing","content":"bad"}' } }] } }))).mockResolvedValueOnce(new Response(JSON.stringify({ model: 'test', message: { role: 'assistant', content: 'File was not found.' } })));
    try {
      await runChatTurn([{ role: 'user', content: 'Write firmware' }], new AbortController().signal, true, () => {});
      expect(JSON.parse(JSON.parse(transport.mock.calls[1][1]!.body as string).messages.at(-1).content).success).toBe(false);
      expect(useEditorStore.getState().files[0].content).toBe('old');
    } finally { transport.mockRestore(); }
  });
  it('derives build instructions from current state and invalidates compile evidence after firmware changes', () => {
    recordBuildOperation('compile', { success: true, data: { compiled: true } });
    expect(currentBuildResult().compilation_result.success).toBe(true);
    expect(currentBuildResult().firmware[0].content).toBe('old');
    useEditorStore.getState().setFileContent('firmware', 'new source');
    expect(currentBuildResult().compilation_result.success).toBe(false);
    expect(currentBuildResult().firmware[0].content).toBe('new source');
  });

  it('awaits destructive approval and reports rejection without mutating firmware', async () => {
    useEditorStore.getState().setFileContent('firmware', 'original source '.repeat(30));
    const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ model: 'test', message: { role: 'assistant', content: null, tool_calls: [{ id: 'approval-call', type: 'function', function: { name: 'set_firmware', arguments: '{"file":"firmware","content":"new"}' } }] } }))).mockResolvedValueOnce(new Response(JSON.stringify({ model: 'test', message: { role: 'assistant', content: 'Change rejected.' } })));
    try {
      const approval = vi.fn(async () => false);
      const progress = vi.fn();
      await runChatTurn([{ role: 'user', content: 'Replace code' }], new AbortController().signal, true, progress, approval);
      expect(approval).toHaveBeenCalledOnce();
      expect(useEditorStore.getState().files[0].content).toBe('original source '.repeat(30));
      expect(progress.mock.calls.some(([event]) => event.activity?.status === 'awaiting_approval')).toBe(true);
      expect(progress.mock.calls.some(([event]) => event.activity?.status === 'rejected')).toBe(true);
    } finally { transport.mockRestore(); }
  });

  it('bounds repeated model calls at 15 operations', async () => {
    let calls = 0;
    const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ model: 'test', message: { role: 'assistant', content: null, tool_calls: [{ id: `limit-${++calls}`, type: 'function', function: { name: 'get_firmware', arguments: '{}' } }] } })));
    const progress = vi.fn();
    try {
      await expect(runChatTurn([{ role: 'user', content: 'Keep reading' }], new AbortController().signal, true, progress)).rejects.toThrow('limit reached');
      expect(progress.mock.calls.filter(([event]) => event.activity?.status === 'success')).toHaveLength(15);
      expect(calls).toBe(16);
    } finally { transport.mockRestore(); }
  });

  it('does not execute calls in plain-chat mode', async () => {
    const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ model: 'test', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call1', type: 'function', function: { name: 'set_firmware', arguments: '{"file":"firmware","content":"bad"}' } }] } })));
    try {
      await expect(runChatTurn([{ role: 'user', content: 'hello' }], new AbortController().signal, false, () => {})).rejects.toThrow('Plain chat');
      expect(useEditorStore.getState().files[0].content).toBe('old');
    } finally { transport.mockRestore(); }
  });
});
