import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page = await context.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
fs.mkdirSync('artifacts',{recursive:true});
try {
  await page.goto('http://127.0.0.1:5173/prototype');
  await page.waitForFunction(()=>Boolean(window.__velxioStores));
  await page.evaluate(()=>{window.__velxioStores.useSimulatorStore.setState({boards:[],components:[],wires:[],activeBoardId:null});});
  await expect(page.getByText('Your prototype starts with a circuit.')).toBeVisible();
  await page.getByRole('link',{name:'Ideate',exact:true}).click();
  await page.locator('.wu-home-template').nth(1).click();
  await page.waitForURL('**/editor');
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await page.getByRole('button',{name:'Assistant',exact:true}).click();
  const assistant=page.locator('.wu-assistant');
  await expect(assistant).toContainText('WIREUP_AI_API_KEY');
  await page.route('**/wireup-ai/status',route=>route.fulfill({json:{configured:true,model:'browser-test',message:'Test provider configured'}}));
  await assistant.getByRole('button',{name:'Check configuration'}).click();
  await expect(assistant).toContainText('browser-test');
  let original, modified;
  await page.route('**/wireup-ai/proposals',route=>{
    const {project}=route.request().postDataJSON();
    const file=project.files.find(f=>f.name.endsWith('.ino'));
    original=file.content; modified=file.content+'\n// Browser verification change\n';
    return route.fulfill({json:{revision:project.revision,explanation:'Browser test: review a reversible firmware edit.',files:[{...file,op:'set_file',content:modified}],circuit:[]}});
  });
  await assistant.getByLabel('What would you like to build or fix?').fill('Add a test comment');
  await assistant.getByRole('button',{name:'Ask Wireup',exact:true}).click();
  await expect(assistant.getByRole('button',{name:'Apply reviewed changes'})).toBeEnabled();
  await assistant.getByRole('button',{name:'Apply reviewed changes'}).click();
  await expect(assistant).toContainText('Changes applied.');
  await expect.poll(()=>page.evaluate(()=>window.__velxioStores.useEditorStore.getState().files.find(f=>f.name.endsWith('.ino')).content)).toBe(modified);
  await assistant.getByRole('button',{name:'Undo AI changes'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__velxioStores.useEditorStore.getState().files.find(f=>f.name.endsWith('.ino')).content)).toBe(original);
  await assistant.getByRole('button',{name:'Ask Wireup',exact:true}).click();
  await assistant.getByRole('button',{name:'Reject proposal'}).click();
  await expect(assistant).toContainText('Proposal rejected.');
  await page.getByRole('button',{name:'Close assistant'}).click();
  await page.getByRole('link',{name:'Prototype',exact:true}).click();
  await page.getByRole('button',{name:'Wiring',exact:true}).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  const connectionCount=await page.locator('tbody tr').count();
  expect(connectionCount).toBeGreaterThan(0);
  await page.reload();
  await page.getByRole('button',{name:'Wiring',exact:true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(connectionCount);
  for (const name of [/Source archive/,/Bill of materials Spreadsheet/,/Wiring list/]) {
    const waiting=page.waitForEvent('download');
    await page.getByRole('button',{name}).click();
    const file=await waiting; await file.saveAs('artifacts/'+file.suggestedFilename());
  }
  await page.getByRole('button',{name:/Flash Arduino Uno/}).click();
  await expect(page.locator('body')).toContainText('Wireup Desktop');
  console.log('FLASH_DIALOG',await page.getByRole('dialog').innerText());
  await page.keyboard.press('Escape');
  if(await page.getByRole('dialog').count()) await page.getByRole('dialog').getByRole('button',{name:/Close/i}).first().click();
  await page.getByRole('link',{name:'Ideate',exact:true}).click();
  const projectName=await page.locator('.wu-home-project-open strong').first().innerText();
  await page.getByRole('button',{name:'Delete '+projectName,exact:true}).click();
  await page.getByRole('button',{name:'Keep project'}).click();
  await expect(page.locator('.wu-home-project')).toHaveCount(1);
  await page.getByRole('button',{name:'Delete '+projectName,exact:true}).click();
  await page.getByRole('button',{name:'Delete project',exact:true}).click();
  await expect(page.locator('.wu-home-project')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('wireup-active-project'))).toBe(null);
  await page.goto('http://127.0.0.1:5173/examples/blink-led');
  await expect(page.getByRole('heading',{name:'Blink LED',exact:true})).toBeVisible();
  await page.getByRole('button',{name:/Open in Simulator/i}).click();
  await page.waitForURL('**/example/blink-led');
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await page.getByRole('link',{name:'Prototype',exact:true}).click();
  await expect(page.locator('.wu-prototype-summary')).toContainText('Physical parts');
  await page.goto('http://127.0.0.1:5173/examples/not-real');
  await expect(page.locator('body')).toContainText('not found');
  for(const route of ['/es/','/es/editor','/es/prototype','/tools/image-to-code','/en/','/unrecognized']){
    await page.goto('http://127.0.0.1:5173'+route);
    await expect(page.getByRole('link',{name:'Wireup home'})).toBeVisible();
    await expect(page.locator('.wu-main')).not.toBeEmpty();
  }
  await page.getByRole('button',{name:'Built on Velxio'}).click();
  await expect(page.getByRole('dialog',{name:'About Wireup'})).toContainText('AGPLv3');
  await page.getByRole('button',{name:'Close about'}).click();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    for(const route of ['/','/editor','/prototype','/examples']){
      await page.goto('http://127.0.0.1:5173'+route);
      await expect(page.locator('.wu-main')).not.toBeEmpty();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
  }
  console.log('PAGE_ERRORS',errors);expect(errors).toEqual([]);
  console.log('PASS Wireup regression, AI review/apply/undo, wired project, exports and shared routes');
} catch(error) { console.log('FAIL_SCREEN',await page.locator('body').innerText()); throw error; } finally {await browser.close();}
