let pending: string | null = null;
export function queueBuildPrompt(prompt: string) { pending = prompt; }
export function takeBuildPrompt(): string | null { const prompt = pending; pending = null; return prompt; }
