import { z } from 'zod';
import { getApiBase } from '../lib/apiBase';
const option = z.object({ id: z.string().min(1).max(64), label: z.string().min(1).max(180), description: z.string().max(300).optional() });
export const buildQuestionsSchema = z.object({ questions: z.array(z.object({ id: z.string().min(1).max(64), question: z.string().min(1).max(400), options: z.array(option).min(3).max(5), reason: z.string().max(400).optional() })).length(10), model: z.string() });
export type BuildQuestions = z.infer<typeof buildQuestionsSchema>;
export async function getBuildQuestions(request: string, signal: AbortSignal): Promise<BuildQuestions> {
  const response = await fetch(`${getApiBase()}/ai/chat/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request }), signal });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) { const error = z.object({ detail: z.string() }).safeParse(data); throw new Error(error.success ? error.data.detail : `Cannot prepare project questions (${response.status}).`); }
  return buildQuestionsSchema.parse(data);
}
export function answeredBuildRequest(request: string, questions: BuildQuestions['questions'], answers: Record<string, string>): string {
  if (questions.length !== 10) throw new Error('Prepare ten project questions before generating.');
  const selections = questions.map(question => {
    const selected = question.options.find(option => option.id === answers[question.id]);
    if (!selected) throw new Error('Answer all ten project questions before generating.');
    return `${question.question}: ${selected.label}${selected.description ? ` (${selected.description})` : ''}`;
  });
  return `${request}\nProject-specific answers:\n${selections.join('\n')}\nReuse suitable existing parts. Execute at most 15 tools; report incomplete work honestly.`;
}
