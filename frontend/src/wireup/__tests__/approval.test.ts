import { describe, expect, it } from 'vitest';
import { destructiveReason } from '../toolApproval';
import type { ToolActivity } from '../chatClient';
const project = { snapshot: { editor: { fileGroups: { group: [{ id: 'f', name: 'sketch.ino', content: 'existing source '.repeat(30) }] } } } };
const activity = (name: string, args: Record<string, unknown>): ToolActivity => ({ id: 'call', name, args, status: 'running' });
describe('destructive tool confirmations', () => {
  it('allows normal additive build operations', () => {
    for (const name of ['add_component', 'connect', 'compile_firmware', 'start_simulation', 'get_build_result']) expect(destructiveReason(activity(name, {}), project, new Set())).toBeNull();
  });
  it('confirms removal and rewiring before execution', () => {
    expect(destructiveReason(activity('remove_component', { component_id: 'led' }), project, new Set())).toContain('led');
    expect(destructiveReason(activity('disconnect', { wire_id: 'wire' }), project, new Set())).toContain('wire');
    expect(destructiveReason(activity('update_connection', { wire_id: 'wire' }), project, new Set())).toContain('Replace');
  });
  it('protects substantial original firmware but permits correcting firmware authored in the same turn', () => {
    const change = activity('set_firmware', { file: 'f', content: 'new' });
    expect(destructiveReason(change, project, new Set())).toContain('sketch.ino');
    expect(destructiveReason(change, project, new Set(['f']))).toBeNull();
    expect(destructiveReason(activity('set_firmware', { file: 'f', content: project.snapshot.editor.fileGroups.group[0].content }), project, new Set())).toBeNull();
  });
});
