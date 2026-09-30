// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
const circuit={format:'velxio-project',version:1,exportedAt:new Date().toISOString(),boards:[{id:'uno',boardKind:'arduino-uno',x:0,y:0,activeFileGroupId:'group-uno'}],components:[{id:'led',metadataId:'led',x:100,y:0,properties:{color:'red'}}],wires:[{id:'w1',start:{componentId:'uno',pinName:'13',x:0,y:0},end:{componentId:'led',pinName:'A',x:100,y:0},color:'green',waypoints:[]}],fileGroups:{'group-uno':[{name:'sketch.ino',content:'void setup(){} void loop(){}'}]},activeBoardId:'uno'};
vi.mock('../../utils/vlxFile',()=>({buildVlxPayload:()=>structuredClone(circuit),parseVlxFile:vi.fn()}));
vi.mock('../../utils/projectPayload',()=>({buildSavePayload:()=>({boards_json:JSON.stringify(circuit.boards)})}));
vi.mock('../../utils/loadExample',()=>({loadExample:vi.fn()}));
vi.mock('../../store/useEditorStore',()=>({useEditorStore:{getState:()=>({fileGroups:{'group-uno':[{id:'main',name:'sketch.ino',content:'void setup(){} void loop(){}',modified:false}]},folderGroups:{},activeGroupId:'group-uno',activeGroupFileId:{'group-uno':'main'},openGroupFileIds:{'group-uno':['main']}})}}));
vi.mock('../../store/useSimulatorStore',()=>({useSimulatorStore:{getState:()=>({})}}));
vi.mock('../../store/useVfsStore',()=>({useVfsStore:{getState:()=>({boards:{},selectedNodeId:{}})}}));
vi.mock('../../store/useElectricalStore',()=>({useElectricalStore:{getState:()=>({})}}));
vi.mock('../../store/useProjectStore',()=>({useProjectStore:{getState:()=>({})}}));
import {captureProjectSnapshot,createProject,validateProject,projectFilename} from '../project';
import {buildPrototypeModel,prototypeCsv,buildSourceArchive} from '../prototypeModel';
describe('Wireup project documents',()=>{
 it('round trips files and circuit in a versioned document',()=>{const p=createProject('Bench');expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);expect(p.snapshot.editor.fileGroups['group-uno'][0].name).toBe('sketch.ino');});
 it('rejects future formats',()=>{expect(()=>validateProject({...createProject(),version:2})).toThrow();});
 it('rejects dangling wiring',()=>{const p=createProject();p.snapshot.circuit.wires[0].end.componentId='missing';expect(()=>validateProject(p)).toThrow();});
 it('rejects mismatched source data',()=>{const p=createProject();p.snapshot.editor.fileGroups['group-uno'][0].content='different';expect(()=>validateProject(p)).toThrow();});
 it('rejects duplicate parts',()=>{const p=createProject();p.snapshot.circuit.components.push(p.snapshot.circuit.components[0]);expect(()=>validateProject(p)).toThrow();});
 it('rejects unsafe source paths',()=>{const p=createProject();p.snapshot.editor.fileGroups['group-uno'][0].name='../secret';expect(()=>validateProject(p)).toThrow();});
 it('derives physical parts and connections',()=>{const m=buildPrototypeModel(captureProjectSnapshot());expect(m.bom.map(r=>r.kind)).toEqual(['arduino-uno','led','jumper-wire']);expect(m.connections[0].from).toBe('uno.13');expect(m.sourceCount).toBe(1);});
 it('escapes spreadsheet formula injection',()=>{const m=buildPrototypeModel(captureProjectSnapshot());m.bom[0].label='=SUM(A1)';expect(prototypeCsv(m,'bom')).toContain('"\'=SUM(A1)"');});
 it('creates a source archive',async()=>{expect((await buildSourceArchive(captureProjectSnapshot())).size).toBeGreaterThan(100);});
 it('makes safe download names',()=>{expect(projectFilename('My circuit / test')).toBe('My-circuit-test.wireup.json');});
});
