import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { ArrowUp, ListChecks, Plus } from 'lucide-react';
import './Assistant.css';
import {
  getAIStatus,
  requestAIProposal,
  type AIProjectContext,
  type AIProposal,
  type AIStatus,
} from './aiClient';
import {
  applyAIProposal,
  captureAIProject,
  getProjectRevision,
  subscribeProjectRevision,
  type AppliedProposal,
} from './assistantProject';

export interface AssistantProps {
  className?: string;
  style?: CSSProperties;
  onApplied?: () => void;
}

interface Review {
  proposal: AIProposal;
  context: AIProjectContext;
  state: 'review' | 'rejected' | 'applied' | 'undone';
  applied?: AppliedProposal;
}

export function Assistant({ className, style, onApplied }: AssistantProps) {
  const promptId = useId();
  const configurationId = useId();
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const revision = useSyncExternalStore(
    subscribeProjectRevision,
    getProjectRevision,
    getProjectRevision,
  );
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const controller = useRef<AbortController | null>(null);
  const statusController = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    statusController.current = abort;
    getAIStatus(abort.signal)
      .then(setStatus)
      .catch((err: unknown) => {
        if (!abort.signal.aborted)
          setError(err instanceof Error ? err.message : 'Cannot read AI configuration.');
      });
    return () => {
      abort.abort();
      statusController.current?.abort();
      controller.current?.abort();
    };
  }, []);

  async function checkStatus() {
    statusController.current?.abort();
    const abort = new AbortController();
    statusController.current = abort;
    setChecking(true);
    setError('');
    try {
      const next = await getAIStatus(abort.signal);
      if (!abort.signal.aborted) setStatus(next);
    } catch (err) {
      if (!abort.signal.aborted)
        setError(err instanceof Error ? err.message : 'Cannot read AI configuration.');
    } finally {
      if (!abort.signal.aborted) setChecking(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || review?.state === 'review') return;
    setError('');
    setNotice('');
    setSubmittedPrompt(prompt.trim());
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    const timeout = setTimeout(() => abort.abort('timeout'), 100_000);
    try {
      const context = captureAIProject();
      const proposal = await requestAIProposal(prompt.trim(), context, abort.signal);
      if (!abort.signal.aborted) setReview({ proposal, context, state: 'review' });
    } catch (err) {
      if (abort.signal.aborted) {
        if (abort.signal.reason === 'timeout')
          setError('AI request timed out. Try a smaller prompt or check the provider.');
      } else
        setError(err instanceof Error ? err.message : 'AI request failed. No changes applied.');
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setNotice(
      'Request cancelled. No proposal was applied. The provider may still finish processing the request.',
    );
  }

  function apply() {
    if (!review || review.state !== 'review') return;
    setError('');
    try {
      const applied = applyAIProposal(review.proposal);
      setReview({ ...review, state: 'applied', applied });
      setNotice('Changes applied. Review the circuit and compile manually before running.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply proposal.');
      return;
    }
    onApplied?.();
  }

  function undo() {
    if (!review?.applied) return;
    setError('');
    try {
      review.applied.undo();
      setReview({ ...review, state: 'undone' });
      setNotice('AI proposal undone.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not undo proposal.');
    }
  }

  const stale = review?.proposal.revision !== revision;
  const blockSubmit = busy || !status?.configured || review?.state === 'review';
  const hasTranscript = Boolean(submittedPrompt || error || notice || review || busy);
  return (
    <section
      className={`wu-ai-panel${className ? ` ${className}` : ''}`}
      aria-label="Wireup AI assistant"
      style={style}
    >
      <div
        className="wu-ai-transcript"
        hidden={!hasTranscript}
        aria-label="Assistant conversation"
        tabIndex={0}
      >
        {submittedPrompt && (
          <div className="wu-ai-message wu-ai-message--user" aria-label="Your request">
            <small>You</small>
            <p>{submittedPrompt}</p>
          </div>
        )}
        {busy && (
          <p className="wu-ai-notice" role="status">
            Requesting proposal… No changes applied.
          </p>
        )}
        {error && (
          <p className="wu-ai-notice" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="wu-ai-notice" role="status">
            {notice}
          </p>
        )}
        {review && (
          <article className="wu-ai-review" aria-label="AI proposal review">
            <h3>Proposal · {review.state}</h3>
            <p className="wu-ai-explanation">{review.proposal.explanation}</p>
            <strong className="wu-ai-verification">
              Not compiled, simulated, or electrically verified.
            </strong>
            {review.proposal.files.map((edit) => {
              const before =
                review.context.files.find(
                  (file) => file.group_id === edit.group_id && file.name === edit.name,
                )?.content ?? '';
              return (
                <details key={`${edit.group_id}/${edit.name}`}>
                  <summary>
                    Replace {edit.group_id}/{edit.name}
                  </summary>
                  <h4>Current at request time</h4>
                  <pre>{before}</pre>
                  <h4>Proposed complete replacement</h4>
                  <pre>{edit.content}</pre>
                </details>
              );
            })}
            {review.proposal.circuit.length > 0 && (
              <div>
                <h4>Circuit changes</h4>
                <ul>
                  {review.proposal.circuit.map((edit, index) => (
                    <li key={index}>
                      {edit.op === 'add_wire'
                        ? `Connect ${edit.start.component_id}.${edit.start.pin_name} → ${edit.end.component_id}.${edit.end.pin_name} (${edit.color})`
                        : (() => {
                            const wire = review.context.wires.find(
                              (item) => item.id === edit.wire_id,
                            );
                            return `Remove ${edit.wire_id}${wire ? `: ${wire.start.component_id}.${wire.start.pin_name} → ${wire.end.component_id}.${wire.end.pin_name}` : ''}`;
                          })()}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {review.state === 'review' && (
              <>
                {stale && (
                  <p role="status">
                    Project changed since this request. Reject this proposal and request a fresh
                    one.
                  </p>
                )}
                <div className="wu-ai-review-actions">
                  <button
                    type="button"
                    onClick={apply}
                    disabled={
                      stale || (!review.proposal.files.length && !review.proposal.circuit.length)
                    }
                  >
                    Apply reviewed changes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReview({ ...review, state: 'rejected' });
                      setNotice('Proposal rejected. No changes applied.');
                    }}
                  >
                    Reject proposal
                  </button>
                </div>
              </>
            )}
            {review.state === 'applied' && (
              <>
                <button type="button" onClick={undo} disabled={!review.applied?.canUndo()}>
                  Undo AI changes
                </button>
                {!review.applied?.canUndo() && (
                  <small>
                    Undo is unavailable because a newer project edit or history action followed.
                  </small>
                )}
              </>
            )}
          </article>
        )}
      </div>
      <div className="wu-ai-input-area">
        <details
          id={configurationId}
          className="wu-ai-configuration"
          open={configurationOpen}
          onToggle={(event) => setConfigurationOpen(event.currentTarget.open)}
        >
          <summary>
            <span
              className={`wu-ai-config-dot${status?.configured ? ' is-ready' : ''}`}
              aria-hidden="true"
            />
            {status
              ? status.configured
                ? 'Provider connected'
                : 'Configuration required'
              : 'Checking configuration…'}
            <span className="wu-ai-config-details">Details</span>
          </summary>
          <div className="wu-ai-config-content">
            <p>{status?.message ?? 'Checking backend AI configuration…'}</p>
            {status?.configured && <small>Model: {status.model}</small>}
            {!status?.configured && (
              <p>
                Set <code>WIREUP_AI_API_KEY</code> on the backend, optionally{' '}
                <code>WIREUP_AI_BASE_URL</code> and <code>WIREUP_AI_MODEL</code>, then restart it.
              </p>
            )}
            <p>
              Submitting sends current firmware, board/libraries, component IDs and rendered pin
              names to the configured provider. No API key is stored in your browser. Open the
              circuit view for pin-aware suggestions.
            </p>
            <button type="button" onClick={() => void checkStatus()} disabled={checking}>
              {checking ? 'Checking…' : 'Check configuration'}
            </button>
          </div>
        </details>
        <form className="wu-ai-composer" onSubmit={(event) => void submit(event)}>
          <label className="wu-ai-sr-only" htmlFor={promptId}>
            What would you like to build or fix?
          </label>
          <textarea
            id={promptId}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={8000}
            rows={3}
            disabled={busy}
            placeholder="Build, test, or iterate..."
          />
          <div className="wu-ai-composer-tools">
            <button
              className="wu-ai-config-button"
              type="button"
              aria-label="AI configuration"
              title="AI configuration"
              aria-expanded={configurationOpen}
              aria-controls={configurationId}
              onClick={() => setConfigurationOpen((open) => !open)}
            >
              <Plus size={17} aria-hidden="true" />
            </button>
            <span
              className="wu-ai-mode"
              title="Proposals require your review. Nothing is applied automatically."
            >
              <ListChecks size={14} aria-hidden="true" />
              Review before apply
            </span>
            <span className="wu-ai-composer-spacer" />
            {prompt.length > 0 && (
              <small className="wu-ai-count">
                {prompt.length}/8000<span className="wu-ai-sr-only"> characters</span>
              </small>
            )}
            {busy && (
              <button className="wu-ai-cancel" type="button" onClick={cancel}>
                Cancel request
              </button>
            )}
            <button
              className="wu-ai-send"
              type="submit"
              disabled={blockSubmit || !prompt.trim()}
              aria-label={busy ? 'Requesting proposal…' : 'Ask Wireup'}
              title={
                review?.state === 'review'
                  ? 'Apply or reject the current proposal first'
                  : !status?.configured
                    ? 'Configure the backend provider first'
                    : 'Ask Wireup'
              }
            >
              <ArrowUp size={17} aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

export default Assistant;
