import { useId } from 'react';
import type { ToolActivity, ToolApproval } from './chatClient';
import './AssistantActivity.css';

export interface AssistantActivityProps {
  activities: ToolActivity[];
  approval: ToolApproval | null;
  onApprove: () => void;
  onReject: () => void;
}

const groups = [
  { title: 'Project', tools: ['get_project_state', 'get_circuit', 'search_components'] },
  {
    title: 'Circuit',
    tools: [
      'add_component',
      'remove_component',
      'set_component_property',
      'connect',
      'disconnect',
      'update_connection',
    ],
  },
  {
    title: 'Firmware',
    tools: ['get_firmware', 'set_firmware', 'add_firmware_file', 'compile_firmware'],
  },
  {
    title: 'Simulation',
    tools: ['start_simulation', 'stop_simulation', 'get_simulation_state', 'get_serial_output'],
  },
  { title: 'Build guide', tools: ['get_build_result'] },
];

const labels: Record<string, string> = {
  get_project_state: 'Read project',
  get_circuit: 'Read circuit',
  search_components: 'Search components',
  add_component: 'Add component',
  remove_component: 'Remove component',
  set_component_property: 'Set property',
  connect: 'Connect pins',
  disconnect: 'Disconnect wire',
  update_connection: 'Update connection',
  get_firmware: 'Read firmware',
  set_firmware: 'Update firmware',
  add_firmware_file: 'Add firmware file',
  compile_firmware: 'Compile firmware',
  start_simulation: 'Start simulation',
  stop_simulation: 'Stop simulation',
  get_simulation_state: 'Read simulation state',
  get_serial_output: 'Read serial output',
  get_build_result: 'Read build guide',
};

const statusLabels: Record<ToolActivity['status'], string> = {
  running: 'Running',
  success: 'Success',
  error: 'Error',
  awaiting_approval: 'Awaiting approval',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'No result received.';
  } catch {
    return 'Details could not be serialized.';
  }
}

function endpoints(args: Record<string, unknown>): string {
  const from = [text(args.from_component), text(args.from_pin)].filter(Boolean).join('.');
  const to = [text(args.to_component), text(args.to_pin)].filter(Boolean).join('.');
  return from && to ? `${from} → ${to}` : from || to;
}

function target(activity: ToolActivity): string {
  const args = activity.args;
  if (activity.name === 'connect' || activity.name === 'update_connection') {
    return [text(args.wire_id), endpoints(args)].filter(Boolean).join(': ');
  }
  if (activity.name === 'set_component_property') {
    return [text(args.component_id), text(args.property)].filter(Boolean).join('.');
  }
  return (
    text(args.component_id) ||
    text(args.wire_id) ||
    text(args.file) ||
    text(args.name) ||
    text(args.component_type) ||
    text(args.query)
  );
}

function outcome(activity: ToolActivity): string {
  const result = activity.result;
  if (result && !result.success) return result.error;
  if (activity.status !== 'success' || !result?.success) return target(activity);
  const data = record(result.data);
  const componentId = text(data.component_id) || text(data.id);
  const file = [text(data.name), text(data.file)].filter(Boolean).join(' · ');
  switch (activity.name) {
    case 'add_component': {
      const added = [text(data.component_type), componentId].filter(Boolean).join(' · ');
      return added ? `Added ${added}` : 'Result received; inspect details.';
    }
    case 'remove_component':
      return componentId ? `Removed ${componentId}` : 'Removal result received.';
    case 'set_component_property':
      return [componentId, text(data.property)].filter(Boolean).join('.') || target(activity);
    case 'connect':
    case 'update_connection':
      return [text(record(data.wire).id), endpoints(activity.args)].filter(Boolean).join(': ');
    case 'disconnect':
      return text(data.wire_id)
        ? `Disconnected ${text(data.wire_id)}`
        : 'Disconnection result received.';
    case 'add_firmware_file':
    case 'set_firmware':
      return file || 'Firmware result received.';
    case 'compile_firmware': {
      const board = text(data.boardId) || text(data.component_id);
      const message =
        data.compilationRequired === false
          ? 'No compile required'
          : data.compiled === true
            ? 'Compiled successfully'
            : data.loaded === true
              ? 'Firmware loaded; no compile required'
              : typeof data.preparedChips === 'number'
                ? `Prepared ${data.preparedChips} custom chips`
                : 'Compilation result received; inspect details.';
      return [message, board].filter(Boolean).join(' · ');
    }
    case 'start_simulation':
      return data.started === true || data.running === true
        ? 'Simulation started'
        : data.electricalPaused === false
          ? 'Electrical simulation resumed'
          : 'Start result received; inspect details.';
    case 'stop_simulation':
      return data.stopped === true
        ? 'Simulation stopped'
        : 'Stop result received; inspect details.';
    case 'get_simulation_state':
      return data.running === true
        ? 'Simulation is running'
        : data.running === false
          ? 'Simulation is stopped'
          : 'State received.';
    case 'get_serial_output':
      return typeof data.output === 'string'
        ? `${data.output.length} characters received`
        : 'Serial output received.';
    case 'get_build_result':
      return Array.isArray(data.build_instructions)
        ? `${data.build_instructions.length} build ${data.build_instructions.length === 1 ? 'step' : 'steps'}`
        : 'Build guide received; inspect details.';
    case 'get_firmware':
      return Array.isArray(data.files)
        ? `${data.files.length} firmware ${data.files.length === 1 ? 'file' : 'files'}`
        : 'Firmware received.';
    case 'search_components':
      return Array.isArray(data.components)
        ? `${data.components.length} matches`
        : 'Search result received.';
    case 'get_project_state':
    case 'get_circuit':
      return (
        [
          text(record(data.project).name),
          Array.isArray(data.parts) ? `${data.parts.length} parts` : '',
        ]
          .filter(Boolean)
          .join(' · ') || 'Project state received.'
      );
    default:
      return target(activity) || 'Result received; inspect details.';
  }
}

function affectedTargets(activity: ToolActivity): string[] {
  const keys = [
    'component_id',
    'wire_id',
    'from_component',
    'to_component',
    'file',
    'name',
    'group_id',
    'component_type',
  ];
  return keys.flatMap((key) => {
    const value = text(activity.args[key]);
    return value ? [`${key}: ${value}`] : [];
  });
}

function ActivityRow({ activity }: { activity: ToolActivity }) {
  const status = activity.result?.success === false && activity.status !== 'rejected' ? 'error' : activity.status;
  const summary = outcome(activity);
  return (
    <li className={`wu-ai-activity-row wu-ai-activity-row--${status}`}>
      <details className="wu-ai-activity-details">
        <summary>
          <span
            className={`wu-ai-activity-indicator wu-ai-activity-indicator--${status}`}
            aria-hidden="true"
          >
            {status === 'success'
              ? '✓'
              : status === 'error'
                ? '!'
                : status === 'rejected'
                  ? '×'
                  : status === 'cancelled'
                    ? '−'
                    : status === 'awaiting_approval'
                      ? '?'
                      : null}
          </span>
          <span className="wu-ai-activity-copy">
            <span className="wu-ai-activity-label">{labels[activity.name] ?? activity.name}</span>
            {summary && <span className="wu-ai-activity-outcome">{summary}</span>}
          </span>
          <span className="wu-ai-activity-status">{statusLabels[status]}</span>
        </summary>
        <div className="wu-ai-activity-payload">
          <h4>Arguments</h4>
          <pre>{json(activity.args)}</pre>
          <h4>Result</h4>
          <pre>{json(activity.result)}</pre>
        </div>
      </details>
    </li>
  );
}

export function AssistantActivity({
  activities,
  approval,
  onApprove,
  onReject,
}: AssistantActivityProps) {
  const approvalId = useId();
  if (!activities.length && !approval) return null;
  const affected = approval ? affectedTargets(approval.activity) : [];
  return (
    <section className="wu-ai-activity" aria-label="Project tool activity">
      {groups.map((group, index) => {
        const rows = activities.filter(
          (activity) =>
            group.tools.includes(activity.name) ||
            (index === 0 && !groups.some((known) => known.tools.includes(activity.name))),
        );
        if (!rows.length) return null;
        return (
          <details className="wu-ai-activity-group" key={group.title} open>
            <summary>
              <span>{group.title}</span>
              <span className="wu-ai-activity-count">{rows.length}</span>
            </summary>
            <ul>
              {rows.map((activity) => (
                <ActivityRow key={activity.id} activity={activity} />
              ))}
            </ul>
          </details>
        );
      })}
      {approval && (
        <div
          className="wu-ai-activity-approval"
          role="dialog"
          aria-modal={false}
          aria-labelledby={`${approvalId}-title`}
          aria-describedby={`${approvalId}-reason`}
        >
          <h3 id={`${approvalId}-title`}>Confirm project change</h3>
          <p id={`${approvalId}-reason`}>{approval.reason}</p>
          <p className="wu-ai-activity-approval-operation">
            {labels[approval.activity.name] ?? approval.activity.name}
          </p>
          {affected.length > 0 && (
            <ul aria-label="Affected IDs and files">
              {affected.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <details className="wu-ai-activity-approval-details">
            <summary>Change details</summary>
            <pre>{json(approval.activity.args)}</pre>
          </details>
          <div className="wu-ai-activity-approval-actions">
            <button type="button" onClick={onApprove}>
              Allow change
            </button>
            <button type="button" onClick={onReject}>
              Reject change
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
