import { create } from 'zustand';
import { createStore, get, update } from 'idb-keyval';
import { z } from 'zod';
import { buildVlxPayload, parseVlxFile } from '../utils/vlxFile';
import { buildSavePayload } from '../utils/projectPayload';
import { loadExample } from '../utils/loadExample';
import type { ExampleProject } from '../data/examples';
import { isKnownBoardKind } from '../types/board';
import type { BoardInstance } from '../types/board';
import { useEditorStore } from '../store/useEditorStore';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useVfsStore } from '../store/useVfsStore';
import { useElectricalStore } from '../store/useElectricalStore';
import { useProjectStore } from '../store/useProjectStore';

export const PROJECT_VERSION = 1;
export const PROJECT_FORMAT = 'wireup-project';
const DATABASE_KEY = 'projects';
const ACTIVE_PROJECT_KEY = 'wireup-active-project';
function rememberActiveProject(id: string | null): void {
  // The restore hint is optional; unavailable localStorage must not fail an IndexedDB save.
  try {
    if (id) localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    else localStorage.removeItem(ACTIVE_PROJECT_KEY);
  } catch { /* Browser storage may be disabled. */ }
}
let database: ReturnType<typeof createStore> | undefined;
const db = () => (database ??= createStore('wireup-projects', 'projects'));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const nameSchema = z.string().trim().min(1).max(120);
const idSchema = z.string().min(1).refine((id) => !['__proto__', 'constructor', 'prototype'].includes(id));
const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const source = z.object({ name: z.string().min(1), content: z.string() });
const workspaceFile = source.extend({ id: idSchema, modified: z.boolean() });
const uploads = z.array(z.object({ name: z.string(), contentB64: z.string() }));
const board = point.extend({
  id: idSchema,
  boardKind: z.string().refine(isKnownBoardKind, 'Unsupported board kind'),
  activeFileGroupId: idSchema,
  name: z.string().optional(),
  languageMode: z.enum(['arduino', 'micropython', 'espidf', 'python']).optional(),
  serialBaudRate: z.number().finite().nonnegative().optional(),
  libraries: z.array(z.string()).optional(),
  sdFiles: uploads.optional(),
  spiffsFiles: z.array(z.object({ name: z.string(), contentB64: z.string(), size: z.number().nonnegative() }).passthrough()).optional(),
  boardOptions: z.record(z.unknown()).optional(),
}).passthrough();
const endpoint = point.extend({ componentId: idSchema, pinName: z.string().min(1) });
const wire = z.object({
  id: idSchema, start: endpoint, end: endpoint, color: z.string(),
  waypoints: z.array(point), bb: z.boolean().optional(), autoRouted: z.boolean().optional(),
  signalType: z.enum(['power-vcc', 'power-gnd', 'analog', 'digital', 'pwm', 'i2c', 'spi', 'usart']).optional(),
}).passthrough();
const component = point.extend({
  id: idSchema, metadataId: z.string().min(1), properties: z.record(z.unknown()).optional(),
  rotation: z.number().finite().optional(),
}).passthrough();
const node = z.object({
  id: idSchema, name: z.string(), type: z.enum(['file', 'directory']),
  content: z.string().optional(), children: z.array(idSchema).optional(), parentId: idSchema.nullable(),
});
const editorSchema = z.object({
  fileGroups: z.record(idSchema, z.array(workspaceFile)), folderGroups: z.record(idSchema, z.array(z.string())),
  activeGroupId: z.string(), activeGroupFileId: z.record(idSchema, z.string()),
  openGroupFileIds: z.record(idSchema, z.array(z.string())),
});
const circuitSchema = z.object({
  format: z.literal('velxio-project'), version: z.literal(1), exportedAt: z.string(), name: z.string().optional(),
  boards: z.array(board), fileGroups: z.record(idSchema, z.array(source)),
  folderGroups: z.record(idSchema, z.array(z.string())).optional(),
  components: z.array(component), wires: z.array(wire), activeBoardId: idSchema.nullable(),
});
const snapshotSchema = z.object({
  circuit: circuitSchema,
  editor: editorSchema,
  vfs: z.object({
    boards: z.record(idSchema, z.object({ tree: z.record(idSchema, node), rootId: idSchema })),
    selectedNodeId: z.record(idSchema, idSchema.nullable()),
  }),
}).superRefine((snapshot, ctx) => {
  const { circuit, editor, vfs } = snapshot;
  const ids = [...circuit.boards, ...circuit.components].map((part) => part.id);
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (new Set(ids).size !== ids.length) fail('Duplicate board/component IDs');
  if (new Set(circuit.wires.map((w) => w.id)).size !== circuit.wires.length) fail('Duplicate wire IDs');
  if (circuit.activeBoardId && !circuit.boards.some((b) => b.id === circuit.activeBoardId)) fail('Active board is missing');
  for (const b of circuit.boards) if (!Object.hasOwn(editor.fileGroups, b.activeFileGroupId)) fail(`Missing file group for ${b.id}`);
  for (const w of circuit.wires) if (!ids.includes(w.start.componentId) || !ids.includes(w.end.componentId)) fail(`Dangling wire ${w.id}`);
  for (const [gid, files] of Object.entries(editor.fileGroups)) {
    if (new Set(files.map((f) => f.id)).size !== files.length || new Set(files.map((f) => f.name)).size !== files.length) fail(`Duplicate files in ${gid}`);
    if (files.some((f) => /(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[a-z]:/i.test(f.name))) fail('Source paths must be workspace-relative');
    if (JSON.stringify(files.map(({ name, content }) => ({ name, content }))) !== JSON.stringify(circuit.fileGroups[gid])) fail(`Inconsistent file group ${gid}`);
    const active = editor.activeGroupFileId[gid];
    if (active && files.length && !files.some((f) => f.id === active)) fail(`Missing active file in ${gid}`);
    if ((editor.openGroupFileIds[gid] ?? []).some((id) => !files.some((f) => f.id === id))) fail(`Missing open file in ${gid}`);
  }
  if (Object.keys(editor.fileGroups).length && !Object.hasOwn(editor.fileGroups, editor.activeGroupId)) fail('Active file group is missing');
  for (const { tree, rootId } of Object.values(vfs.boards)) {
    if (!tree[rootId] || tree[rootId].parentId !== null) fail('Invalid VFS root');
    for (const [id, n] of Object.entries(tree)) {
      if (n.id !== id || (n.parentId && !tree[n.parentId]) || n.children?.some((child) => !tree[child] || tree[child].parentId !== id)) fail('Invalid VFS node references');
      const visited = new Set<string>();
      let cursor: string | null = id;
      while (cursor && tree[cursor]) {
        if (visited.has(cursor)) { fail('Cyclic VFS tree'); break; }
        visited.add(cursor); cursor = tree[cursor].parentId;
      }
    }
  }
});
const projectSchema = z.object({
  format: z.literal(PROJECT_FORMAT), version: z.literal(PROJECT_VERSION), id: idSchema,
  name: nameSchema, description: z.string(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  templateId: z.string().optional(), snapshot: snapshotSchema,
});
export type ProjectSnapshot = z.infer<typeof snapshotSchema>;
export type WireupProject = z.infer<typeof projectSchema>;
export type ProjectSummary = Omit<WireupProject, 'snapshot'> & { boardCount: number; componentCount: number; wireCount: number };

export function validateProject(data: unknown): WireupProject {
  return projectSchema.parse(data);
}

export function captureProjectSnapshot(): ProjectSnapshot {
  const editor = useEditorStore.getState();
  const vfs = useVfsStore.getState();
  const circuit = buildVlxPayload();
  // The server serializer includes board options and SPIFFS omitted by .vlx.
  circuit.boards = JSON.parse(buildSavePayload().boards_json ?? '[]');
  circuit.fileGroups = Object.fromEntries(Object.entries(editor.fileGroups).map(([gid, files]) => [gid, files.map(({ name, content }) => ({ name, content }))]));
  circuit.folderGroups = editor.folderGroups;
  return snapshotSchema.parse(clone({
    circuit,
    editor: {
      fileGroups: editor.fileGroups, folderGroups: editor.folderGroups,
      activeGroupId: editor.activeGroupId, activeGroupFileId: editor.activeGroupFileId, openGroupFileIds: editor.openGroupFileIds,
    },
    vfs: { boards: vfs.boards, selectedNodeId: vfs.selectedNodeId },
  }));
}

let suspended = 0;
function applySnapshot(snapshot: ProjectSnapshot): void {
  const { circuit, editor } = clone(snapshot);
  useSimulatorStore.getState().loadProjectState(circuit as unknown as Parameters<ReturnType<typeof useSimulatorStore.getState>['loadProjectState']>[0]);
  // loadProjectState recreates default group IDs and does not restore baud rates.
  for (const b of circuit.boards) useSimulatorStore.getState().updateBoard(b.id, b as unknown as Partial<BoardInstance>);
  if (circuit.activeBoardId) useSimulatorStore.getState().setActiveBoardId(circuit.activeBoardId);
  else useSimulatorStore.setState({ activeBoardId: null });
  const files = editor.fileGroups[editor.activeGroupId] ?? [];
  useEditorStore.setState({ ...editor, files, activeFileId: editor.activeGroupFileId[editor.activeGroupId] ?? '', openFileIds: editor.openGroupFileIds[editor.activeGroupId] ?? [], manifestViewBoardId: null });
  useVfsStore.setState(clone(snapshot.vfs));
  useElectricalStore.getState().reset();
  useElectricalStore.getState().setPaused(false);
}

/** Validate before mutation; rehydrate the previous workspace if any store fails. */
export function restoreProjectSnapshot(data: ProjectSnapshot): void {
  const snapshot = snapshotSchema.parse(clone(data));
  const previous = captureProjectSnapshot();
  const identity = useProjectStore.getState();
  suspended++;
  try {
    useProjectStore.getState().clearCurrentProject();
    applySnapshot(snapshot);
    detachProject();
  } catch (error) {
    try { applySnapshot(previous); }
    finally { useProjectStore.setState({ currentProject: identity.currentProject, currentExampleId: identity.currentExampleId }); }
    throw error;
  } finally { suspended--; }
}

const fingerprint = (snapshot: ProjectSnapshot) => JSON.stringify({ ...snapshot, circuit: { ...snapshot.circuit, exportedAt: '' } });
export interface ProjectSession {
  project: WireupProject | null;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}
export const useWireupProject = create<ProjectSession>(() => ({ project: null, dirty: false, saving: false, error: null }));
let baseline = '';
let savingCount = 0;
let revision = 0;
let pendingOpen: { id: string; token: number } | null = null;
function activate(project: WireupProject): void {
  revision++;
  baseline = fingerprint(captureProjectSnapshot());
  useWireupProject.setState({ project, dirty: false, error: null });
  rememberActiveProject(project.id);
}

export function createProject(name = 'Untitled circuit', description = ''): WireupProject {
  const now = new Date().toISOString();
  return validateProject({ format: PROJECT_FORMAT, version: PROJECT_VERSION, id: crypto.randomUUID(), name, description, createdAt: now, updatedAt: now, snapshot: captureProjectSnapshot() });
}

async function mutateProjects<T>(operation: (projects: Record<string, WireupProject>) => T): Promise<T> {
  let result!: T;
  await update<Record<string, WireupProject>>(DATABASE_KEY, (current) => {
    const projects = { ...(current ?? {}) };
    result = operation(projects);
    return projects;
  }, db());
  return result;
}
export async function saveProject(project: WireupProject): Promise<WireupProject> {
  const saved = validateProject(clone({ ...project, updatedAt: new Date().toISOString() }));
  await mutateProjects((projects) => { projects[saved.id] = saved; });
  return saved;
}
export async function loadProject(id: string): Promise<WireupProject> {
  const projects = await get<Record<string, WireupProject>>(DATABASE_KEY, db());
  if (!projects || !Object.hasOwn(projects, id)) throw new Error('Project not found');
  return validateProject(clone(projects[id]));
}
export async function listProjects(): Promise<ProjectSummary[]> {
  const projects = await get<Record<string, WireupProject>>(DATABASE_KEY, db());
  return Object.values(projects ?? {}).map((data) => {
    const { snapshot, ...meta } = validateProject(data);
    return { ...meta, boardCount: snapshot.circuit.boards.length, componentCount: snapshot.circuit.components.length, wireCount: snapshot.circuit.wires.length };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
const deletingProjects = new Set<string>();
export async function deleteProject(id: string): Promise<void> {
  deletingProjects.add(id);
  if (useWireupProject.getState().project?.id === id || pendingOpen?.id === id) revision++;
  try {
    await mutateProjects((projects) => { delete projects[id]; });
    if (useWireupProject.getState().project?.id === id) detachProject();
    else {
      try {
        if (localStorage.getItem(ACTIVE_PROJECT_KEY) === id) rememberActiveProject(null);
      } catch { /* Browser storage may be disabled. */ }
    }
  } finally { deletingProjects.delete(id); }
}
export async function renameProject(id: string, name: string): Promise<WireupProject> {
  const validName = nameSchema.parse(name);
  const saved = await mutateProjects((projects) => {
    if (!Object.hasOwn(projects, id)) throw new Error('Project not found');
    const next = validateProject({ ...projects[id], name: validName, updatedAt: new Date().toISOString() });
    projects[id] = next;
    return next;
  });
  if (useWireupProject.getState().project?.id === id) useWireupProject.setState({ project: saved });
  return clone(saved);
}
export async function duplicateProject(id: string, name?: string): Promise<WireupProject> {
  const original = await loadProject(id);
  const now = new Date().toISOString();
  return saveProject({ ...original, id: crypto.randomUUID(), name: name ?? `${original.name.slice(0, 113)} (copy)`, createdAt: now, updatedAt: now });
}
export async function openProject(id: string): Promise<WireupProject> {
  if (deletingProjects.has(id)) throw new Error('Project deletion is in progress');
  const token = ++revision;
  pendingOpen = { id, token };
  try {
    const project = await loadProject(id);
    if (revision !== token) throw new Error('Project open was superseded by a workspace change');
    restoreProjectSnapshot(project.snapshot);
    activate(project);
    return project;
  } finally {
    if (pendingOpen?.token === token) pendingOpen = null;
  }
}
export function detachProject(): void {
  revision++;
  baseline = '';
  rememberActiveProject(null);
  useWireupProject.setState({ project: null, dirty: false, error: null });
}
export async function saveCurrentProject(name?: string): Promise<WireupProject> {
  const session = useWireupProject.getState();
  const project = session.project ?? createProject(name);
  if (deletingProjects.has(project.id)) throw new Error('Project deletion is in progress');
  const token = revision;
  const snapshot = captureProjectSnapshot();
  const savedFingerprint = fingerprint(snapshot);
  savingCount++;
  useWireupProject.setState({ saving: true, error: null });
  try {
    const saved = await saveProject({ ...project, name: name ?? project.name, snapshot });
    if (revision === token) {
      baseline = savedFingerprint;
      rememberActiveProject(saved.id);
      useWireupProject.setState({ project: saved, dirty: fingerprint(captureProjectSnapshot()) !== baseline });
    }
    return saved;
  } catch (error) {
    if (revision === token) useWireupProject.setState({ dirty: true, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    savingCount--;
    useWireupProject.setState({ saving: savingCount > 0 });
  }
}

export async function createProjectFromExample(example: ExampleProject, name = example.title): Promise<WireupProject> {
  const previous = captureProjectSnapshot();
  const session = useWireupProject.getState();
  const previousBaseline = baseline;
  const identity = useProjectStore.getState();
  suspended++;
  detachProject();
  try {
    await loadExample(example);
    const project = await saveProject({ ...createProject(name, example.description), templateId: example.id });
    activate(project);
    return project;
  } catch (error) {
    restoreProjectSnapshot(previous);
    useProjectStore.setState({ currentProject: identity.currentProject, currentExampleId: identity.currentExampleId });
    baseline = previousBaseline;
    rememberActiveProject(session.project?.id ?? null);
    useWireupProject.setState({ project: session.project, dirty: session.dirty, error: session.error });
    throw error;
  } finally { suspended--; }
}

export function exportProject(project: WireupProject): Blob {
  return new Blob([JSON.stringify(validateProject(project), null, 2)], { type: 'application/json' });
}
export async function importProject(file: File): Promise<WireupProject> {
  const data: unknown = JSON.parse(await file.text());
  let project: WireupProject;
  if (typeof data === 'object' && data !== null && 'format' in data && data.format === 'velxio-project') {
    const circuit = await parseVlxFile(file);
    if (circuit.version !== 1) throw new Error('Unsupported .vlx version');
    const fileGroups = Object.fromEntries(Object.entries(circuit.fileGroups).map(([gid, files]) => [gid, files.map((f, index) => ({ ...f, id: `${gid}-${index}`, modified: false }))]));
    const activeGroupId = circuit.boards.find((b) => b.id === circuit.activeBoardId)?.activeFileGroupId ?? Object.keys(fileGroups)[0] ?? '';
    project = validateProject({ ...createProject(circuit.name ?? file.name.replace(/\.[^.]+$/, '')), snapshot: {
      circuit,
      editor: { fileGroups, folderGroups: circuit.folderGroups ?? {}, activeGroupId, activeGroupFileId: Object.fromEntries(Object.entries(fileGroups).map(([gid, files]) => [gid, files[0]?.id ?? ''])), openGroupFileIds: Object.fromEntries(Object.entries(fileGroups).map(([gid, files]) => [gid, files[0] ? [files[0].id] : []])) },
      vfs: { boards: {}, selectedNodeId: {} },
    } });
  } else project = validateProject(data);
  const now = new Date().toISOString();
  // Imports always get a new identity and cannot overwrite an existing project.
  return saveProject({ ...project, id: crypto.randomUUID(), createdAt: now, updatedAt: now });
}

/** Mount once in the parent shell. Returns flush/dispose for navigation and teardown. */
export function startProjectAutosave(delay = 800): { flush: () => Promise<void>; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const changed = () => {
    if (disposed || suspended) return;
    if (timer) clearTimeout(timer);
    const session = useWireupProject.getState();
    if (!session.project) return;
    try {
      const dirty = fingerprint(captureProjectSnapshot()) !== baseline;
      useWireupProject.setState({ dirty });
      if (dirty) {
        const token = revision;
        timer = setTimeout(() => {
          timer = undefined;
          if (!disposed && !suspended && revision === token && useWireupProject.getState().project) void saveCurrentProject().catch(() => {});
        }, delay);
      }
    } catch (error) {
      useWireupProject.setState({ dirty: true, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const subscriptions = [useSimulatorStore.subscribe(changed), useEditorStore.subscribe(changed), useVfsStore.subscribe(changed)];
  const unsubscribeIdentity = useProjectStore.subscribe((state, previous) => {
    if (!suspended && (state.currentProject !== previous.currentProject || state.currentExampleId !== previous.currentExampleId)) detachProject();
  });
  return {
    async flush() {
      if (timer) clearTimeout(timer);
      if (!suspended && useWireupProject.getState().project && fingerprint(captureProjectSnapshot()) !== baseline) await saveCurrentProject();
    },
    dispose() { disposed = true; if (timer) clearTimeout(timer); subscriptions.forEach((unsubscribe) => unsubscribe()); unsubscribeIdentity(); },
  };
}

export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
export function projectFilename(name: string, extension = 'wireup.json'): string {
  return `${name.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 80) || 'wireup-project'}.${extension}`;
}
