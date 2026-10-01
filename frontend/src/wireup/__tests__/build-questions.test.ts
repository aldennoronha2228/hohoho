import { describe, expect, it } from 'vitest';
import { answeredBuildRequest, buildQuestionsSchema } from '../buildQuestions';
const questions = Array.from({ length: 10 }, (_, index) => ({ id: `q${index}`, question: `Project choice ${index}`, options: [{ id: 'a', label: 'Choice A' }, { id: 'b', label: 'Choice B' }, { id: 'c', label: 'Choose for me' }] }));
describe('project-specific setup answers', () => {
  it('requires ten valid questions', () => {
    expect(buildQuestionsSchema.safeParse({ questions: questions.slice(0, 3), model: 'test' }).success).toBe(false);
    expect(buildQuestionsSchema.safeParse({ questions, model: 'test' }).success).toBe(true);
  });
  it('includes the actual answers with the original build request', () => {
    const answers = Object.fromEntries(questions.map(question => [question.id, 'b']));
    const prompt = answeredBuildRequest('Build an ultrasonic robot', questions, answers);
    expect(prompt).toContain('Build an ultrasonic robot');
    expect(prompt.match(/Choice B/g)).toHaveLength(10);
  });
  it('blocks missing answers instead of selecting defaults silently', () => {
    expect(() => answeredBuildRequest('Build robot', questions, {})).toThrow('Answer all ten');
  });
});
