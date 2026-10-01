import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { EditorPage } from '../pages/EditorPage';
import { Assistant } from './Assistant';
import { takeBuildPrompt } from './pendingChat';
import { loadBuildSession, prepareBuildSession } from './buildSessions';
import { useWireupProject } from './project';
import './BuildConversation.css';
import { SimulationStatus } from './SimulationStatus';
import { getBuildQuestions, answeredBuildRequest, type BuildQuestions } from './buildQuestions';

export function BuildConversation() {
  const [request, setRequest] = useState(() => takeBuildPrompt() ?? '');
  const [questions, setQuestions] = useState<BuildQuestions['questions']>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionRequest, setQuestionRequest] = useState('');
  const [questionLoading, setQuestionLoading] = useState(false);
  const questionAbort = useRef<AbortController | null>(null);
  const [buildPrompt, setBuildPrompt] = useState('');
  const projectId = useWireupProject(state => state.project?.id ?? null);
  const [startedProjectId, setStartedProjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const edited = useRef(false);
  const mounted = useRef(false);
  const [surface, setSurface] = useState<'conversation' | 'circuit'>('conversation');
  const started = projectId !== null && startedProjectId === projectId;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; questionAbort.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void loadBuildSession(projectId).then(session => {
      if (!cancelled && !edited.current && session) setRequest(current => current || session.draft);
    }).catch(err => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Cannot load the saved build conversation.');
    });
    return () => { cancelled = true; };
  }, [projectId]);
  async function prepareQuestions() {
    if (!request.trim() || questionLoading) return;
    questionAbort.current?.abort();
    const abort = new AbortController(); questionAbort.current = abort;
    const input = request.trim();
    setQuestionLoading(true); setError('');
    try {
      const result = await getBuildQuestions(input, abort.signal);
      if (!abort.signal.aborted) { setQuestions(result.questions); setAnswers({}); setQuestionRequest(input); }
    } catch (err) { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'Cannot prepare project questions.'); }
    finally { if (!abort.signal.aborted) setQuestionLoading(false); }
  }
  async function startBuild(event: FormEvent) {
    event.preventDefault();
    if (!request.trim() || submitting.current) return;
    submitting.current = true;
    setSaving(true); setError('');
    try {
      const prompt = answeredBuildRequest(request, questions, answers);
      if (prompt.length > 8000) throw new Error('The request and answers are too long. Shorten your request.');
      const session = await prepareBuildSession(request);
      setBuildPrompt(prompt);
      if (mounted.current) { setShowHistory(false); setStartedProjectId(session.projectId); }
    } catch (err) {
      if (mounted.current) setError(`Build not started: ${err instanceof Error ? err.message : 'Cannot save the local project.'} Retry saving before generating.`);
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  const ready = questions.length === 10 && questionRequest === request.trim() && questions.every(question => answers[question.id]);
  return <section className="wu-build-page">
    <header className="wu-build-header"><strong>Wireup · Build conversation</strong><nav><button onClick={() => setSurface('conversation')} aria-pressed={surface === 'conversation'}>Conversation</button><button onClick={() => setSurface('circuit')} aria-pressed={surface === 'circuit'}>Circuit & firmware</button><Link to="/prototype">Build guide</Link></nav></header>
    <SimulationStatus/>
    <div className={`wu-build-editor ${surface === 'circuit' ? 'is-visible' : ''}`}><EditorPage/></div>
    <div className={`wu-build-conversation ${surface === 'conversation' ? 'is-visible' : ''}`}>
      {!started && !showHistory ? <form className="wu-build-questions" onSubmit={event => void startBuild(event)} aria-busy={saving}><h2>Set up your build</h2><label>Your request<textarea value={request} onChange={event => { edited.current = true; setRequest(event.target.value); }} disabled={saving} required maxLength={7000}/></label>
        <button type="button" disabled={saving || questionLoading || !request.trim()} onClick={() => void prepareQuestions()}>{questionLoading ? 'Preparing project-specific questions…' : questions.length ? 'Regenerate questions' : 'Prepare project questions'}</button>
        {questionLoading && <p role="status">The AI is reading your request and preparing ten relevant questions.</p>}
        {questionRequest === request.trim() && questions.map((question, index) => <fieldset key={question.id}><legend>{index + 1}. {question.question}</legend>{question.reason && <p>{question.reason}</p>}{question.options.map(option => <label key={option.id}><input type="radio" name={question.id} value={option.id} checked={answers[question.id] === option.id} disabled={saving} onChange={() => setAnswers(current => ({ ...current, [question.id]: option.id }))}/><span>{option.label}{option.description && <small style={{ display: 'block', color: 'var(--wu-muted)' }}>{option.description}</small>}</span></label>)}</fieldset>)}<p>Existing parts are reused. Destructive changes require confirmation. One request is limited to 15 tool calls.</p>{error && <p role="alert">{error}</p>}<button type="submit" disabled={saving || !ready}>{saving ? 'Saving local project…' : 'Start generating'}</button>{projectId && <button type="button" onClick={() => setShowHistory(true)}>Open saved conversation</button>}</form> : <Assistant className="wu-build-chat" initialPrompt={showHistory ? undefined : buildPrompt}/>}
    </div>
  </section>;
}
