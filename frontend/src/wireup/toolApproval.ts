import type { ToolActivity } from './chatClient';

export interface ApprovalProject {
  snapshot: { editor: { fileGroups: Record<string, { id: string; name: string; content: string }[]> } };
}

/** Existing content is protected; firmware written in this turn can be debugged automatically. */
export function destructiveReason(activity: ToolActivity, initial: ApprovalProject, authoredFiles: Set<string>): string | null {
  const { name, args } = activity;
  if (name === 'remove_component') return `Remove component ${String(args.component_id)} and all its attached wires?`;
  if (name === 'disconnect') return `Delete existing wire ${String(args.wire_id)}?`;
  if (name === 'update_connection') return `Replace the endpoints of existing wire ${String(args.wire_id)}?`;
  if (name === 'set_firmware') {
    const files = Object.values(initial.snapshot.editor.fileGroups).flat();
    const matches = files.filter(file => file.id === args.file || file.name === args.file);
    const file = matches.length === 1 ? matches[0] : undefined;
    if (file && !authoredFiles.has(file.id) && file.content !== args.content && (file.content.trim().length >= 200 || file.content.split('\n').length >= 8)) {
      return `Replace existing firmware ${file.name} (${file.content.length} characters) with the requested content?`;
    }
  }
  return null;
}
