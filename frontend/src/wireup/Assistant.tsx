import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowUp, MessageSquare, Plus } from 'lucide-react';
import { getChatStatus, runChatTurn, type ChatMessage, type ChatStatus, type ToolActivity, type ToolApproval } from './chatClient';
import { useLocation } from 'react-router-dom';
import { executeWireupTool } from './tools';
import { useSyncExternalStore } from 'react';
import { currentBuildResult } from './tools/buildResult';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useEditorStore } from '../store/useEditorStore';
import { useWireupProject } from './project';
import './Assistant.css';
import { AssistantActivity } from './AssistantActivity';

const subscribeBuildState = (listener: () => void) => {
  const offs = [useSimulatorStore.subscribe(listener), useEditorStore.subscribe(listener), useWireupProject.subscribe(listener)];
  return () => offs.forEach(off => off());
};
const buildState = () => JSON.stringify({ components: useSimulatorStore.getState().components, wires: useSimulatorStore.getState().wires, boards: useSimulatorStore.getState().boards, files: useEditorStore.getState().fileGroups });

export interface AssistantProps {
  className?: string;
  style?: CSSProperties;
}

export function Assistant({ className, style }: AssistantProps) {
  const location = useLocation();
  const canUseProject = /\/(editor|example\/)/.test(location.pathname);
  const [operateProject, setOperateProject] = useState(false);
  const [operation, setOperation] = useState('');
  const [showBuild, setShowBuild] = useState(false);
  const [activities, setActivities] = useState<ToolActivity[]>([]);
  const [approval, setApproval] = useState<ToolApproval | null>(null);
  const approvalResolver = useRef<((allowed: boolean) => void) | null>(null);
  useSyncExternalStore(subscribeBuildState, buildState, () => '');
  const promptId = useId();
  const configurationId = useId();
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const statusController = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const pendingUsesTools = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    statusController.current = abort;
    getChatStatus(abort.signal).then(next => { if (!abort.signal.aborted) setStatus(next); }).catch(err => {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'Cannot read chat configuration.');
    });
    return () => { abort.abort(); statusController.current?.abort(); controller.current?.abort(); if (pendingUsesTools.current) void executeWireupTool('stop_simulation'); };
  }, []);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }, [messages, busy, error]);

  async function checkStatus() {
    statusController.current?.abort();
    const abort = new AbortController();
    statusController.current = abort;
    setChecking(true); setError('');
    try {
      const next = await getChatStatus(abort.signal);
      if (!abort.signal.aborted) setStatus(next);
    } catch (err) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'Cannot read chat configuration.');
    } finally { if (!abort.signal.aborted) setChecking(false); }
  }

  function resolveApproval(allowed: boolean) {
    approvalResolver.current?.(allowed);
    approvalResolver.current = null;
    setApproval(null);
  }
  function requestApproval(next: ToolApproval, signal: AbortSignal): Promise<boolean> {
    return new Promise(resolve => {
      const abort = () => { approvalResolver.current = null; setApproval(null); resolve(false); };
      signal.addEventListener('abort', abort, { once: true });
      approvalResolver.current = allowed => { signal.removeEventListener('abort', abort); resolve(allowed); };
      setApproval(next);
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || controller.current || !status?.configured) return;
    const last = messages.at(-1);
    if (last?.role === 'assistant' && last.tool_calls?.length) { setError('The previous turn stopped before its tools completed. Start a new chat before continuing.'); return; }
    const outgoing: ChatMessage[] = [...messages, { role: 'user', content }];
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError(''); setNotice('');
    setMessages(outgoing); setPrompt('');
    const withTools = canUseProject && operateProject;
    pendingUsesTools.current = withTools;
    let progressed = false;
    const timeout = setTimeout(() => abort.abort('timeout'), withTools ? 600_000 : 100_000);
    try {
      const response = await runChatTurn(outgoing, abort.signal, withTools, progress => {
        if (controller.current !== abort || abort.signal.aborted) return;
        progressed = true;
        setMessages(progress.messages); setOperation(progress.operation ?? '');
        if (progress.activity) {
          const next = progress.activity;
          setActivities(current => current.some(item => item.id === next.id) ? current.map(item => item.id === next.id ? next : item) : [...current, next]);
        }
      }, requestApproval);
      if (controller.current === abort && !abort.signal.aborted) {
        setMessages(response.messages); setOperation('');
        if (withTools) setShowBuild(true);
      }
    } catch (err) {
      if (controller.current === abort) {
        if (!progressed) { setMessages(messages); setPrompt(content); }
        else setNotice('The request stopped after tool activity. Completed changes remain in the project.');
        if (abort.signal.reason === 'timeout') setError('AI request timed out. Check the provider or try again.');
        else if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'AI chat request failed.');
      }
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) {
        if (abort.signal.aborted && withTools) void executeWireupTool('stop_simulation');
        setActivities(current => current.map(item => ['running', 'awaiting_approval'].includes(item.status) ? { ...item, status: 'cancelled' } : item));
        controller.current = null; pendingUsesTools.current = false; setBusy(false); setOperation('');
      }
    }
  }

  function cancel() {
    controller.current?.abort();
    resolveApproval(false);
    setActivities(current => current.map(item => ['running', 'awaiting_approval'].includes(item.status) ? { ...item, status: 'cancelled' } : item));
    if (canUseProject && operateProject) void executeWireupTool('stop_simulation');
    controller.current = null; pendingUsesTools.current = false;
    setBusy(false); setOperation('');
    const pending = messages.at(-1);
    if (pending?.role === 'user') { setPrompt(pending.content ?? ''); setMessages(messages.slice(0, -1)); }
    setNotice('Request cancelled. Completed changes remain in the workspace; an in-flight operation may still finish. Simulation stop was requested.');
  }

  function newChat() {
    if (controller.current) return;
    setMessages([]); setShowBuild(false); setActivities([]); setError(''); setNotice('');
  }

  const hasTranscript = messages.length > 0 || busy || Boolean(error || notice);
  const build = showBuild ? currentBuildResult() : null;
  return <section className={`wu-ai-panel${className ? ` ${className}` : ''}`} aria-label="Wireup AI assistant" style={style}>
    <div ref={transcript} className="wu-ai-transcript" hidden={!hasTranscript} aria-label="Assistant conversation" tabIndex={0}>
      {messages.map((message, index) => message.role === 'tool' || !message.content ? null : <div key={index} className={`wu-ai-message${message.role === 'user' ? ' wu-ai-message--user' : ''}`} aria-label={message.role === 'user' ? 'Your request' : 'AI response'}>
        <small>{message.role === 'user' ? 'You' : 'Wireup AI'}</small><p>{message.content}</p>
      </div>)}
      <AssistantActivity activities={activities} approval={approval} onApprove={() => resolveApproval(true)} onReject={() => resolveApproval(false)}/>
      {busy && <p className="wu-ai-notice" role="status">{approval ? 'Waiting for your confirmation…' : operation ? `Running ${operation}…` : 'Waiting for the AI response…'}</p>}
      {error && <p className="wu-ai-notice" role="alert">{error}</p>}
      {notice && <p className="wu-ai-notice" role="status">{notice}</p>}
      {build && <article className="wu-ai-message" aria-label="Current prototype result"><h3>Current prototype</h3><p>{build.project_overview.name}</p><details><summary>Components</summary><ul>{build.components.map((part, index) => <li key={index}>{part.quantity} × {part.component} — {part.purpose}</li>)}</ul></details><details><summary>Wiring</summary><ul>{build.wiring.map(wire => <li key={wire.id}>{wire.from} → {wire.to}</li>)}</ul></details><details><summary>Firmware</summary>{build.firmware.map(file => <div key={`${file.group_id}/${file.file}`}><strong>{file.name}</strong><pre>{file.content}</pre></div>)}</details><details><summary>Build instructions</summary><ol>{build.build_instructions.map(step => <li key={step.step}>{step.instruction}</li>)}</ol></details><details><summary>Compilation result</summary><pre>{JSON.stringify(build.compilation_result, null, 2)}</pre></details><details><summary>Simulation result</summary><pre>{JSON.stringify(build.simulation_result, null, 2)}</pre></details><p>Derived from the current workspace. Physical hardware is not verified.</p></article>}
    </div>
    <div className="wu-ai-input-area">
      <details id={configurationId} className="wu-ai-configuration" open={configurationOpen} onToggle={event => setConfigurationOpen(event.currentTarget.open)}>
        <summary><span className={`wu-ai-config-dot${status?.configured ? ' is-ready' : ''}`} aria-hidden="true"/>{status ? status.configured ? 'Provider configured' : 'Configuration required' : 'Checking configuration…'}<span className="wu-ai-config-details">Details</span></summary>
        <div className="wu-ai-config-content">
          <p>{status?.message ?? 'Checking backend chat configuration…'}</p>
          {status?.configured && <small>Model: {status.model}</small>}
          {!status?.configured && <p>Set <code>AI_API_KEY</code> on the backend, optionally <code>AI_BASE_URL</code> and <code>AI_MODEL</code>, then restart it.</p>}
          <p>Keys stay on the server. Plain chat sends only the conversation. Enable project tools in Editor to let the model read and change the current project, compile firmware, and run simulation. Tool results and project data are then sent to the provider. Physical hardware flashing is unavailable.</p>
          <button type="button" onClick={() => void checkStatus()} disabled={checking}>{checking ? 'Checking…' : 'Check configuration'}</button>
        </div>
      </details>
      <form className="wu-ai-composer" onSubmit={event => void submit(event)}>
        <label className="wu-ai-sr-only" htmlFor={promptId}>What would you like to build or fix?</label>
        <textarea id={promptId} value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={8000} rows={3} disabled={busy} placeholder="Ask Wireup about your hardware project…"/>
        <div className="wu-ai-composer-tools">
          <button className="wu-ai-config-button" type="button" aria-label="AI configuration" title="AI configuration" aria-expanded={configurationOpen} aria-controls={configurationId} onClick={() => setConfigurationOpen(open => !open)}><Plus size={17} aria-hidden="true"/></button>
          {canUseProject ? <label className="wu-ai-mode"><input type="checkbox" checked={operateProject} disabled={busy} onChange={event => { setOperateProject(event.target.checked); setMessages([]); setActivities([]); setShowBuild(false); setError(''); }}/>Use project tools</label> : <span className="wu-ai-mode"><MessageSquare size={14} aria-hidden="true"/>Chat</span>}
          <span className="wu-ai-composer-spacer"/>
          {messages.length > 0 && <button type="button" onClick={newChat} disabled={busy}>New chat</button>}
          {prompt.length > 0 && <small className="wu-ai-count">{prompt.length}/8000<span className="wu-ai-sr-only"> characters</span></small>}
          {busy && <button className="wu-ai-cancel" type="button" onClick={cancel}>Cancel request</button>}
          <button className="wu-ai-send" type="submit" disabled={busy || !status?.configured || !prompt.trim()} aria-label="Ask Wireup" title={!status?.configured ? 'Configure the backend provider first' : 'Ask Wireup'}><ArrowUp size={17} aria-hidden="true"/></button>
        </div>
      </form>
    </div>
  </section>;
}
export default Assistant;
