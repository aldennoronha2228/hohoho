import { createStore, del, entries, get, update } from 'idb-keyval';
import { z } from 'zod';
import { chatMessageSchema } from './chatClient';
import { openProject, saveCurrentProject, useWireupProject } from './project';

export const BUILD_SESSION_VERSION = 1;
export const BUILD_SESSION_MAX_BYTES = 2097152;
const projectIdSchema = z.string().min(1).max(256).refine(id => !['__proto__', 'constructor', 'prototype'].includes(id));
const credentialKey = /^(api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|secret|provider[_-]?config(uration)?)$/i;

function isSafeJson(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 524288;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 4096 && value.every(item => isSafeJson(item, depth + 1));
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const items = Object.entries(value);
  return items.length <= 4096 && items.every(([key, item]) => key.length <= 256 && !credentialKey.test(key) && isSafeJson(item, depth + 1));
}
const jsonValue = z.unknown().refine(value => isSafeJson(value), 'Expected bounded JSON without credentials');
const activitySchema = z.object({
  id: z.string().min(1).max(256), name: z.string().min(1).max(128),
  args: z.record(jsonValue).refine(value => isSafeJson(value), 'Tool arguments cannot contain credentials'),
  status: z.enum(['running', 'success', 'error', 'awaiting_approval', 'rejected', 'cancelled']),
  result: z.discriminatedUnion('success', [
    z.object({ success: z.literal(true), data: jsonValue }).strict(),
    z.object({ success: z.literal(false), error: z.string().max(524288) }).strict(),
  ]).optional(),
}).strict();
const contentSchema = z.object({
  draft: z.string().max(8000),
  messages: z.array(chatMessageSchema).max(128),
  activities: z.array(activitySchema).max(256),
}).strict();
const sessionSchema = contentSchema.extend({
  version: z.literal(BUILD_SESSION_VERSION), projectId: projectIdSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict().refine(session => new TextEncoder().encode(JSON.stringify(session)).length <= BUILD_SESSION_MAX_BYTES, 'Build conversation is too large. Start a new chat.');

export type BuildSession = z.infer<typeof sessionSchema>;
export type BuildSessionUpdate = Partial<z.infer<typeof contentSchema>>;
export type BuildSessionSummary = Pick<BuildSession, 'projectId' | 'createdAt' | 'updatedAt' | 'draft'> & { messageCount: number; activityCount: number };
let database: ReturnType<typeof createStore> | undefined;
const db = () => (database ??= createStore('wireup-build-sessions', 'sessions'));

export function currentBuildProjectId(): string {
  const id = useWireupProject.getState().project?.id;
  if (!id) throw new Error('Save or open a local project before using build history.');
  return projectIdSchema.parse(id);
}
export function validateBuildSession(data: unknown): BuildSession {
  return sessionSchema.parse(data);
}
function storedSession(data: unknown, projectId: string): BuildSession {
  const session = validateBuildSession(data);
  if (session.projectId !== projectId) throw new Error('Build session does not match its project.');
  return session;
}
export async function loadBuildSession(projectId = currentBuildProjectId()): Promise<BuildSession | null> {
  const id = projectIdSchema.parse(projectId);
  const data: unknown = await get(id, db());
  return data === undefined ? null : storedSession(data, id);
}
/** Partial updates preserve history when saving only the request draft. */
export async function saveBuildSession(projectId: string, input: BuildSessionUpdate): Promise<BuildSession> {
  const id = projectIdSchema.parse(projectId);
  const patch = contentSchema.partial().parse(input);
  let saved!: BuildSession;
  await update<unknown>(id, current => {
    const now = new Date().toISOString();
    const previous = current === undefined ? { version: BUILD_SESSION_VERSION, projectId: id, createdAt: now, draft: '', messages: [], activities: [] } : storedSession(current, id);
    saved = validateBuildSession({ ...previous, ...patch, updatedAt: now });
    return saved;
  }, db());
  return saved;
}
export async function saveCurrentBuildSession(input: BuildSessionUpdate): Promise<BuildSession> {
  return saveBuildSession(currentBuildProjectId(), input);
}
export async function listBuildSessions(): Promise<BuildSessionSummary[]> {
  const rows = await entries<string, unknown>(db());
  return rows.map(([id, data]) => {
    const session = storedSession(data, projectIdSchema.parse(id));
    return { projectId: session.projectId, createdAt: session.createdAt, updatedAt: session.updatedAt, draft: session.draft, messageCount: session.messages.length, activityCount: session.activities.length };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.projectId.localeCompare(b.projectId));
}
export async function deleteBuildSession(projectId: string): Promise<void> {
  await del(projectIdSchema.parse(projectId), db());
}
/** History navigation explicitly opens the saved workspace; loading history alone never does. */
export async function openBuildSession(projectId: string): Promise<BuildSession | null> {
  const session = await loadBuildSession(projectId);
  await openProject(projectId);
  return session;
}
export function buildProjectName(request: string): string {
  return z.string().trim().min(1).max(8000).parse(request).replace(/\s+/g, ' ').slice(0, 80).trim();
}
/** Save the existing editor snapshot and draft before any provider request can start. */
export async function prepareBuildSession(request: string): Promise<BuildSession> {
  const draft = z.string().trim().min(1).max(7000).parse(request);
  const existing = useWireupProject.getState().project;
  const project = await saveCurrentProject(existing ? undefined : buildProjectName(draft));
  if (useWireupProject.getState().project?.id !== project.id) throw new Error('The active project changed while saving. Start again for the current project.');
  const session = await saveBuildSession(project.id, { draft });
  if (useWireupProject.getState().project?.id !== project.id) throw new Error('The active project changed while saving the conversation. Start again for the current project.');
  return session;
}
