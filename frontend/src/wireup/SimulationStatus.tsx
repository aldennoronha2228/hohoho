import { useEffect, useRef, useState } from 'react';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useElectricalStore } from '../store/useElectricalStore';

export function SimulationStatus() {
  const running = useSimulatorStore(state => state.running || state.boards.some(board => board.running));
  const serial = useSimulatorStore(state => state.serialOutput);
  const error = useElectricalStore(state => state.error);
  const start = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) { start.current = null; return; }
    start.current ??= Date.now();
    const initial = setTimeout(() => setElapsed(0), 0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start.current!) / 1000)), 1000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [running]);
  return <aside className="wu-build-runtime" aria-label="Simulation status"><span role="status">{running ? `Simulation running · ${elapsed}s` : 'Simulation stopped'}</span>{error && <span role="alert">Electrical solver: {error}</span>}<details><summary>Serial output</summary><pre>{serial || 'No serial output received.'}</pre></details><small>Browser simulation does not verify physical hardware.</small></aside>;
}
