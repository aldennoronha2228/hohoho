import { z } from 'zod';
import { getApiBase } from '../lib/apiBase';

const identifier = z.string().min(1).max(128);
const endpoint = z.object({ component_id: identifier, pin_name: identifier }).strict();
const file = z
  .object({
    group_id: identifier,
    name: z.string().min(1).max(200),
    content: z.string().max(100_000),
  })
  .strict();

export const proposalSchema = z
  .object({
    revision: identifier,
    explanation: z.string().min(1).max(16_000),
    files: z.array(file.extend({ op: z.literal('set_file') })).max(32),
    circuit: z
      .array(
        z.discriminatedUnion('op', [
          z
            .object({
              op: z.literal('add_wire'),
              start: endpoint,
              end: endpoint,
              color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            })
            .strict(),
          z.object({ op: z.literal('remove_wire'), wire_id: identifier }).strict(),
        ]),
      )
      .max(64),
  })
  .strict();

export type AIProposal = z.infer<typeof proposalSchema>;
export interface AIProjectContext {
  revision: string;
  active_group_id: string;
  board: string;
  language: string;
  libraries: string[];
  files: z.infer<typeof file>[];
  components: { id: string; kind: string; pins: string[] }[];
  wires: {
    id: string;
    start: z.infer<typeof endpoint>;
    end: z.infer<typeof endpoint>;
    removable: boolean;
  }[];
}

const statusSchema = z.object({ configured: z.boolean(), model: z.string(), message: z.string() });
export type AIStatus = z.infer<typeof statusSchema>;

async function request(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  const response = await fetch(`${getApiBase()}/wireup-ai/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z.object({ detail: z.string() }).safeParse(data);
    throw new Error(
      error.success ? error.data.detail : `Wireup AI request failed (${response.status}).`,
    );
  }
  return data;
}

export async function getAIStatus(signal: AbortSignal): Promise<AIStatus> {
  return statusSchema.parse(await request('status', signal));
}

export async function requestAIProposal(
  prompt: string,
  project: AIProjectContext,
  signal: AbortSignal,
): Promise<AIProposal> {
  const body = { prompt, project };
  if (prompt.trim().length === 0 || prompt.length > 8000)
    throw new Error('Enter a prompt of 1–8000 characters.');
  if (
    JSON.stringify(project).length > 240_000 ||
    new TextEncoder().encode(JSON.stringify(body)).length > 524_288
  ) {
    throw new Error(
      'Project context is too large. Reduce the workspace before requesting AI changes.',
    );
  }
  const proposal = proposalSchema.parse(await request('proposals', signal, body));
  if (proposal.revision !== project.revision)
    throw new Error('Provider response does not match this project revision.');
  return proposal;
}
