import { useEffect, useState } from 'react';
import { ChevronDown, Plus, Search } from 'lucide-react';
import { ComponentRegistry } from '../services/ComponentRegistry';
import { createComponentFromMetadata } from '../components/DynamicComponent';
import { useSimulatorStore } from '../store/useSimulatorStore';
import type { ComponentMetadata } from '../types/component-metadata';
import type { BoardKind } from '../types/board';
import { BOARD_KIND_LABELS } from '../types/board';
import { runEditorCommand } from '../lib/editorCommands';

const boardKinds: BoardKind[] = ['arduino-uno', 'arduino-mega', 'arduino-nano', 'raspberry-pi-pico', 'esp32', 'esp32-c3'];
const curated = ['breadboard', 'resistor', 'capacitor', 'inductor', 'potentiometer', 'led', 'rgb-led', 'pushbutton', 'dht22', 'hc-sr04', 'ssd1306', 'servo', 'buzzer'];
export function ComponentLibrary({ schematic = false }: { schematic?: boolean }) {
  const [parts, setParts] = useState<ComponentMetadata[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const boards = useSimulatorStore(s => s.boards);
  const components = useSimulatorStore(s => s.components);
  useEffect(() => {
    let active = true;
    const registry = ComponentRegistry.getInstance();
    registry.load().then(() => { if (active) setParts(registry.getAllComponents().filter(part => curated.includes(part.id))); }).catch(() => { if (active) setError('Component library could not load.'); });
    return () => { active = false; };
  }, []);
  function add(part: ComponentMetadata | BoardKind) {
    const state = useSimulatorStore.getState();
    if (state.running || state.boards.some(board => board.running)) { setError('Stop simulation before adding a part.'); return; }
    const index = state.boards.length + state.components.length;
    const x = 120 + (index % 3) * 220;
    const y = 100 + Math.floor(index / 3) * 160;
    if (typeof part === 'string') state.addBoard(part, x, y);
    else {
      const component = createComponentFromMetadata(part, x, y);
      state.recordAddComponent(component as Parameters<typeof state.recordAddComponent>[0]);
    }
    setError(''); setNotice(`Added ${typeof part === 'string' ? BOARD_KIND_LABELS[part] : part.name}`);
    runEditorCommand('view.reset');
  }
  const filter = (name: string) => name.toLowerCase().includes(query.toLowerCase());
  const visibleParts = parts.filter(part => filter(`${part.name} ${part.id}`));
  return <aside className="wu-component-library" aria-label="Component library"><header><strong>Components</strong><span>{boards.length + components.length}</span></header>{schematic && <div className="wu-library-tabs"><span>Curated</span><span>Library</span></div>}<label className="wu-library-search"><Search size={12}/><input aria-label="Search components" placeholder={schematic ? 'Search symbols…' : 'Search components…'} value={query} onChange={event => setQuery(event.target.value)}/></label>{error && <p role="alert">{error}</p>}<p className="wu-library-notice" role="status">{notice}</p><div className="wu-library-scroll"><details open><summary>MICROCONTROLLERS <span>{boardKinds.length}</span><ChevronDown size={11}/></summary><div className="wu-library-grid">{boardKinds.filter(kind => filter(BOARD_KIND_LABELS[kind])).map(kind => <button key={kind} title={`Add ${BOARD_KIND_LABELS[kind]}`} onClick={() => add(kind)}><img src={`/boards/${kind === 'raspberry-pi-pico' ? 'pi-pico' : kind === 'esp32' ? 'esp32-devkit-c-v4' : kind}.svg`} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/><span>{BOARD_KIND_LABELS[kind]}</span></button>)}</div></details>{['Breadboard', 'Passives', 'Inputs & outputs'].map((category, index) => { const group = visibleParts.filter(part => index === 0 ? part.id.includes('breadboard') : index === 1 ? ['resistor', 'capacitor', 'inductor', 'potentiometer'].includes(part.id) : !['breadboard', 'resistor', 'capacitor', 'inductor', 'potentiometer'].includes(part.id)); return group.length > 0 && <details open key={category}><summary>{category.toUpperCase()}<span>{group.length}</span><ChevronDown size={11}/></summary><div className={schematic ? 'wu-library-symbols' : 'wu-library-grid'}>{group.map(part => <button key={part.id} title={`Add ${part.name.replace(' (custom)', '')}`} onClick={() => add(part)}>{schematic ? <Plus size={18}/> : <img src={`/component-svgs/${part.id}.svg`} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/>}<span>{part.name.replace(' (custom)', '')}</span></button>)}</div></details>; })}{!visibleParts.length && !boardKinds.some(kind => filter(BOARD_KIND_LABELS[kind])) && <p>No matching components.</p>}</div></aside>;
}
