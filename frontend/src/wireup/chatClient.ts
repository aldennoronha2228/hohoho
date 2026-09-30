import { z } from 'zod';
import { getApiBase } from '../lib/apiBase';
import { destructiveReason, type ApprovalProject } from './toolApproval';
import type { ToolResult } from './tools/runtime';
async function executeWireupTool(name: string, args: unknown = {}) {
  return (await import('./tools')).executeWireupTool(name, args);
}

const toolCallSchema = z.object({
  id: z.string().min(1).max(256), type: z.literal('function'),
  function: z.object({ name: z.string().min(1).max(128), arguments: z.string().max(16000) }).strict(),
}).strict();
export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string().max(524288).nullable(),
  tool_calls: z.array(toolCallSchema).max(4).nullable().optional(),
  tool_call_id: z.string().max(256).optional(),
}).strict();
export type ChatMessage = z.infer<typeof chatMessageSchema>;
const statusSchema = z.object({ configured: z.boolean(), model: z.string(), message: z.string() });
export type ChatStatus = z.infer<typeof statusSchema>;
const responseSchema = z.object({ message: chatMessageSchema.refine(message => message.role === 'assistant', 'Expected an assistant message.'), model: z.string() }).strict();

async function request(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  const response = await fetch(`${getApiBase()}/ai/chat${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = z.object({ detail: z.string() }).safeParse(data);
    throw new Error(detail.success ? detail.data.detail : `Wireup chat request failed (${response.status}).`);
  }
  return data;
}
export async function getChatStatus(signal: AbortSignal): Promise<ChatStatus> {
  return statusSchema.parse(await request('/status', signal));
}
export async function sendChat(messages: ChatMessage[], signal: AbortSignal, tools = false) {
  const parsed = z.array(chatMessageSchema).min(1).max(tools ? 128 : 32).parse(messages);
  const last = parsed.at(-1)!;
  if (!tools && (last.role !== 'user' || parsed.some(message => message.role === 'tool' || message.tool_calls))) throw new Error('Plain chat must end with a user message and contain no tool calls.');
  if (parsed.some(message => message.role === 'user' && (!message.content?.trim() || message.content.length > 8000))) throw new Error('Enter a user message of 1–8000 characters.');
  const body = { messages: parsed };
  if (new TextEncoder().encode(JSON.stringify(body)).length > (tools ? 2097152 : 131072)) throw new Error('Conversation is too large. Start a new chat.');
  const response = responseSchema.parse(await request(tools ? '/turn' : '', signal, body));
  if (!response.message.content?.trim() && !response.message.tool_calls?.length) throw new Error('The provider returned an empty response.');
  if (!tools && response.message.tool_calls?.length) throw new Error('Plain chat cannot execute tool calls.');
  return response;
}

export interface ToolActivity {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'success' | 'error' | 'awaiting_approval' | 'rejected' | 'cancelled';
  result?: ToolResult;
}
export interface ToolApproval { activity: ToolActivity; reason: string }
export interface ChatProgress { messages: ChatMessage[]; operation?: string; activity?: ToolActivity }
export type ApproveTool = (approval: ToolApproval, signal: AbortSignal) => Promise<boolean>;
/** One model, sequential calls to the existing adapters, bounded per user turn. */
export async function runChatTurn(
  initial: ChatMessage[], signal: AbortSignal, useTools: boolean,
  onProgress: (progress: ChatProgress) => void,
  approve?: ApproveTool,
): Promise<{ messages: ChatMessage[]; model: string }> {
  const history = [...initial];
  let calls = 0;
  let compileAttempts = 0;
  let simulationAttempts = 0;
  const callLimit = 64;
  let projectId: string | null | undefined;
  let expectedSnapshot: string | undefined;
  let initialProject: ApprovalProject | undefined;
  const authoredFiles = new Set<string>();
  async function assertProject(acceptOwnChanges = false) {
    const state = await executeWireupTool('get_project_state');
    if (!state.success) throw new Error(state.error);
    if (!initialProject) initialProject = state.data as ApprovalProject;
    const current = (state.data as { project: { id: string } | null }).project?.id ?? null;
    if (projectId === undefined) projectId = current;
    else if (current !== projectId) throw new Error('The active project changed. Start a new request for the current project.');
    const snapshot = structuredClone((state.data as { snapshot: unknown }).snapshot) as { circuit?: { exportedAt?: string } };
    if (snapshot.circuit) delete snapshot.circuit.exportedAt;
    const identity = JSON.stringify(snapshot);
    if (!acceptOwnChanges && expectedSnapshot !== undefined && identity !== expectedSnapshot) throw new Error('The project was edited while the model was responding. Start a fresh request.');
    expectedSnapshot = identity;
  }
  if (useTools) await assertProject();
  while (true) {
    signal.throwIfAborted();
    const response = await sendChat(history, signal, useTools);
    signal.throwIfAborted();
    const message = response.message;
    history.push(message);
    const toolCalls = message.tool_calls ?? [];
    if (!toolCalls.length) { onProgress({ messages: [...history] }); return { messages: history, model: response.model }; }
    if (!useTools) throw new Error('Tool calls are disabled for this chat.');
    for (const call of toolCalls) {
      signal.throwIfAborted();
      await assertProject();
      let outcome: ToolResult;
      let args: Record<string, unknown>;
      try { args = JSON.parse(call.function.arguments) as Record<string, unknown>; }
      catch { args = {}; }
      const activity: ToolActivity = { id: call.id, name: call.function.name, args, status: 'running' };
      let rejected = false;
      const reason = initialProject ? destructiveReason(activity, initialProject, authoredFiles) : null;
      if (reason) {
        activity.status = 'awaiting_approval';
        onProgress({ messages: [...history], activity });
        const allowed = approve ? await approve({ activity, reason }, signal) : false;
        signal.throwIfAborted();
        await assertProject();
        rejected = !allowed;
      }
      if (rejected) outcome = { success: false, error: 'User rejected this change. No changes were made by this tool.' };
      else if (++calls > callLimit) outcome = { success: false, error: 'This turn reached its 64-operation limit. Ask a smaller follow-up.' };
      else if (call.function.name === 'compile_firmware' && ++compileAttempts > 3) outcome = { success: false, error: 'Compilation retry limit reached after three attempts. Report the actual unresolved error.' };
      else if (call.function.name === 'start_simulation' && ++simulationAttempts > 3) outcome = { success: false, error: 'Simulation retry limit reached after three attempts. Report the actual unresolved problem.' };
      else {
        activity.status = 'running';
        onProgress({ messages: [...history], operation: call.function.name, activity: { ...activity } });
        try {
          outcome = await executeWireupTool(call.function.name, args);
          await assertProject(true);
          if (outcome.success && ['set_firmware', 'add_firmware_file'].includes(call.function.name)) {
            const file = (outcome.data as { file?: string }).file;
            if (file) authoredFiles.add(file);
          }
        } catch (error) { outcome = { success: false, error: error instanceof Error ? error.message : String(error) }; }
      }
      const content = JSON.stringify(outcome);
      history.push({ role: 'tool', tool_call_id: call.id, content: content.length > 524288 ? JSON.stringify({ success: false, error: 'Tool result is too large to send. Request a smaller result.' }) : content });
      onProgress({ messages: [...history], activity: { ...activity, status: rejected ? 'rejected' : outcome.success ? 'success' : 'error', result: outcome } });
      signal.throwIfAborted();
    }
    if (calls > callLimit) throw new Error('Tool operation limit reached. Changes already completed remain in the project; inspect the tool results.');
  }
}
