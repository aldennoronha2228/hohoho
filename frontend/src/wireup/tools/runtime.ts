export type ToolResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface ToolRuntime {
  compile(): Promise<ToolResult>;
  start(): Promise<ToolResult>;
  stop(): ToolResult | Promise<ToolResult>;
  busy(): boolean;
}

let runtime: ToolRuntime | null = null;

/** The mounted editor owns its compiler and simulator lifecycle. */
export function registerToolRuntime(next: ToolRuntime): () => void {
  runtime = next;
  return () => { if (runtime === next) runtime = null; };
}

export function getToolRuntime(): ToolRuntime {
  if (!runtime) throw new Error('Open the circuit editor before compiling or controlling simulation.');
  return runtime;
}

export function isToolRuntimeBusy(): boolean {
  return runtime?.busy() ?? false;
}
