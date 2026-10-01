import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listBuildSessions, openBuildSession, type BuildSessionSummary } from './buildSessions';
import { listProjects } from './project';

export function BuildHistory() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<(BuildSessionSummary & { name: string })[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void Promise.all([listBuildSessions(), listProjects()]).then(([history, projects]) => {
      setSessions(history.filter(session => projects.some(project => project.id === session.projectId)).map(session => ({ ...session, name: projects.find(project => project.id === session.projectId)!.name })));
    }).catch(err => setError(err instanceof Error ? err.message : 'Cannot load build history.')).finally(() => setLoading(false));
  }, []);
  return <section className="wu-build-questions"><h1>Build history</h1><p>Saved conversations for projects in this browser.</p>{error && <p role="alert">{error}</p>}{loading ? <p role="status">Loading conversations…</p> : !sessions.length ? <p>No saved build conversations yet.</p> : <ul>{sessions.map(session => <li key={session.projectId}><button onClick={() => { void openBuildSession(session.projectId).then(() => navigate('/build')).catch(err => setError(err instanceof Error ? err.message : 'Cannot open project.')); }}>{session.name}</button><p>{session.messageCount} messages · {session.activityCount} operations · {new Date(session.updatedAt).toLocaleString()}</p></li>)}</ul>}</section>;
}
