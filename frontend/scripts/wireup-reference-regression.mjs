import { chromium, expect } from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1481,height:900},acceptDownloads:true});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
await page.goto('http://127.0.0.1:5173/');await page.getByRole('button',{name:'Blink an LED',exact:true}).click();await page.waitForURL('**/editor');
const assistant=page.locator('.wu-assistant');await assistant.locator('.wu-ai-configuration summary').click();await expect(assistant).toContainText('WIREUP_AI_API_KEY');
await page.route('**/wireup-ai/status',r=>r.fulfill({json:{configured:true,model:'browser-test',message:'Test provider configured'}}));
await assistant.getByRole('button',{name:'Check configuration'}).click();await expect(assistant).toContainText('browser-test');
let original,modified;
await page.route('**/wireup-ai/proposals',r=>{const {project}=r.request().postDataJSON();const file=project.files.find(f=>f.name.endsWith('.ino'));original=file.content;modified=original+'\n// Assistant review test\n';return r.fulfill({json:{revision:project.revision,explanation:'A reversible test edit.',files:[{...file,op:'set_file',content:modified}],circuit:[]}});});
await assistant.getByLabel('What would you like to build or fix?').fill('Add a comment');await assistant.getByRole('button',{name:'Ask Wireup',exact:true}).click();
await assistant.getByRole('button',{name:'Apply reviewed changes'}).click();await expect.poll(()=>page.evaluate(()=>window.__velxioStores.useEditorStore.getState().files.find(f=>f.name.endsWith('.ino')).content)).toBe(modified);
await assistant.getByRole('button',{name:'Undo AI changes'}).click();await expect.poll(()=>page.evaluate(()=>window.__velxioStores.useEditorStore.getState().files.find(f=>f.name.endsWith('.ino')).content)).toBe(original);
await assistant.getByRole('button',{name:'Ask Wireup',exact:true}).click();await assistant.getByRole('button',{name:'Reject proposal'}).click();await expect(assistant).toContainText('Proposal rejected.');
await page.getByRole('link',{name:'Build pack',exact:true}).click();
const downloadWaiting=page.waitForEvent('download');await page.getByRole('button',{name:/Project backup/}).click();const downloaded=await downloadWaiting;await downloaded.saveAs('artifacts/reference-project.wireup.json');
await page.getByRole('link',{name:'Workspace',exact:true}).click();
await page.getByRole('button',{name:'Duplicate Blink LED',exact:true}).click();await expect(page.locator('.wu-home-project')).toHaveCount(2);
await page.getByRole('button',{name:'Rename Blink LED (copy)',exact:true}).click();await page.getByLabel('Project name',{exact:true}).fill('Reference project');await page.getByRole('button',{name:'Save name'}).click();
await page.getByRole('button',{name:'Delete Reference project',exact:true}).click();await page.getByRole('button',{name:'Keep project'}).click();await expect(page.locator('.wu-home-project')).toHaveCount(2);
await page.getByRole('button',{name:'Delete Reference project',exact:true}).click();await page.getByRole('button',{name:'Delete project',exact:true}).click();await expect(page.locator('.wu-home-project')).toHaveCount(1);
await page.locator('input[type=file]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{}')});await expect(page.locator('.wu-home-error')).toBeVisible();await page.getByRole('button',{name:'Dismiss error'}).click();
await page.locator('input[type=file]').setInputFiles('artifacts/reference-project.wireup.json');await page.waitForURL('**/editor');await expect(page.locator('.wu-studio-toolbar')).toContainText('Blink LED');
await page.getByRole('button',{name:'Schematic BETA',exact:true}).click();await expect(page.locator('.wu-schematic-stats')).toContainText('0');
await page.evaluate(()=>window.__velxioStores.useSimulatorStore.setState({boards:[],components:[],wires:[],activeBoardId:null}));await expect(page.locator('.wu-schematic-empty')).toBeVisible();
for(const route of ['/examples','/examples/blink-led','/example/blink-led','/examples/not-real','/es/','/es/editor','/es/prototype','/tools/image-to-code','/en/','/unrecognized']){
await page.goto('http://127.0.0.1:5173'+route);await expect(page.locator('.wu-main')).not.toBeEmpty();await expect(page.getByRole('link',{name:'Workspace',exact:true})).toBeVisible();
if(route==='/example/blink-led'||route==='/es/editor'){await expect(page.locator('.wu-live-canvas')).toBeVisible();await page.getByRole('button',{name:'Schematic BETA',exact:true}).click();await expect(page.locator('.wu-schematic')).toBeVisible();}
}
await page.getByRole('button',{name:'Settings',exact:true}).first().click();await expect(page.getByRole('dialog',{name:'About Wireup'})).toContainText('AGPLv3');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
for(const width of [1481,390]){await page.setViewportSize({width,height:844});for(const route of ['/','/editor','/prototype','/examples']){await page.goto('http://127.0.0.1:5173'+route);await expect(page.locator('.wu-main')).not.toBeEmpty();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}}
console.log('PAGE_ERRORS',errors);expect(errors).toEqual([]);console.log('PASS reference regression: assistant review/apply/undo/reject, projects, imports, empty schematic and shared routes');
}catch(e){console.log('FAIL_SCREEN',await page.locator('body').innerText());throw e;}finally{await browser.close();}
