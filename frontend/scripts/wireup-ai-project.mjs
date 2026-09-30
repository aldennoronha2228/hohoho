import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const live = process.env.WIREUP_CHAT_LIVE === '1';
const ultrasonic = process.env.WIREUP_TEST_PROJECT === 'ultrasonic';
const servo = process.env.WIREUP_TEST_PROJECT === 'servo';
const root = 'http://localhost:5173';
let step = 0; let state; let ledId; let resistorId; let boardId; let firmwareId; let toolResults = [];
function requestCall(name, args) { return { message: { role: 'assistant', content: null, tool_calls: [{ id: `call-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, model: 'browser-function-test' }; }
try {
  if (!live) {
    await page.route('**/api/ai/chat/status', route => route.fulfill({ json: { configured: true, model: 'browser-function-test', message: 'Test settings' } }));
    await page.route('**/api/ai/chat/turn', route => {
      const messages = route.request().postDataJSON().messages;
      const last = messages.at(-1);
      if (last.role === 'tool') {
        const result = JSON.parse(last.content); toolResults.push(result);
        if (!ultrasonic && !servo && step === 9) expect(result.success).toBe(false);
        else expect(result.success, JSON.stringify(result)).toBe(true);
        if (step === 1) { state = result.data; boardId = state.parts.find(part => part.component_type === 'arduino-uno').id; firmwareId = state.snapshot.editor.fileGroups[state.snapshot.editor.activeGroupId][0].id; }
        if (step === 2) ledId = result.data.component_id;
        if (!ultrasonic && !servo && step === 3) resistorId = result.data.component_id;
      }
      const blinkSource = 'void setup(){pinMode(13,OUTPUT);Serial.begin(9600);Serial.println("AI blink circuit running");}\nvoid loop(){digitalWrite(13,HIGH);delay(500);digitalWrite(13,LOW);delay(500);}';
      let answer;
      if (servo) {
        switch (step++) {
          case 0: answer = requestCall('get_project_state', {}); break;
          case 1: answer = requestCall('add_component', { component_type: 'servo', position: { x: 500, y: 120 } }); break;
          case 2: answer = requestCall('connect', { from_component: boardId, from_pin: '5V', to_component: ledId, to_pin: 'V+' }); break;
          case 3: answer = requestCall('connect', { from_component: boardId, from_pin: 'GND.1', to_component: ledId, to_pin: 'GND' }); break;
          case 4: answer = requestCall('connect', { from_component: boardId, from_pin: '9', to_component: ledId, to_pin: 'PWM' }); break;
          case 5: answer = requestCall('set_firmware', { file: firmwareId, content: '#include <Servo.h>\nServo motor;\nvoid setup(){Serial.begin(9600);motor.attach(9);Serial.println("Servo ready");}\nvoid loop(){motor.write(0);delay(500);motor.write(90);delay(500);motor.write(180);delay(500);}' }); break;
          case 6: answer = requestCall('compile_firmware', {}); break;
          case 7: answer = requestCall('start_simulation', {}); break;
          case 8: answer = requestCall('get_build_result', {}); break;
          default: answer = { message: { role: 'assistant', content: 'The servo prototype is present in the workspace; actual compilation and simulation results are available.' }, model: 'browser-function-test' };
        }
      } else if (ultrasonic) {
        switch (step++) {
          case 0: answer = requestCall('get_project_state', {}); break;
          case 1: answer = requestCall('add_component', { component_type: 'hc-sr04', position: { x: 500, y: 120 } }); break;
          case 2: answer = requestCall('connect', { from_component: boardId, from_pin: '5V', to_component: ledId, to_pin: 'VCC' }); break;
          case 3: answer = requestCall('connect', { from_component: boardId, from_pin: 'GND.1', to_component: ledId, to_pin: 'GND' }); break;
          case 4: answer = requestCall('connect', { from_component: boardId, from_pin: '7', to_component: ledId, to_pin: 'TRIG' }); break;
          case 5: answer = requestCall('connect', { from_component: ledId, from_pin: 'ECHO', to_component: boardId, to_pin: '6' }); break;
          case 6: answer = requestCall('set_firmware', { file: firmwareId, content: 'const int trig=7,echo=6; void setup(){Serial.begin(9600);pinMode(trig,OUTPUT);pinMode(echo,INPUT);}\nvoid loop(){digitalWrite(trig,LOW);delayMicroseconds(2);digitalWrite(trig,HIGH);delayMicroseconds(10);digitalWrite(trig,LOW);unsigned long duration=pulseIn(echo,HIGH,30000);Serial.println(duration*0.0343/2);delay(200);}' }); break;
          case 7: answer = requestCall('compile_firmware', {}); break;
          case 8: answer = requestCall('start_simulation', {}); break;
          case 9: answer = requestCall('get_build_result', {}); break;
          default: answer = { message: { role: 'assistant', content: 'The ultrasonic circuit and firmware are present in the workspace. Actual compilation and simulation results and wiring instructions are shown in the current prototype result.' }, model: 'browser-function-test' };
        }
      } else switch (step++) {
        case 0: answer = requestCall('get_project_state', {}); break;
        case 1: answer = requestCall('add_component', { component_type: 'led', position: { x: 500, y: 120 } }); break;
        case 2: answer = requestCall('add_component', { component_type: 'resistor', position: { x: 420, y: 200 } }); break;
        case 3: answer = requestCall('set_component_property', { component_id: resistorId, property: 'value', value: '220' }); break;
        case 4: answer = requestCall('connect', { from_component: boardId, from_pin: '13', to_component: resistorId, to_pin: '1' }); break;
        case 5: answer = requestCall('connect', { from_component: resistorId, from_pin: '2', to_component: ledId, to_pin: 'A' }); break;
        case 6: answer = requestCall('connect', { from_component: ledId, from_pin: 'C', to_component: boardId, to_pin: 'GND.1' }); break;
        case 7: answer = requestCall('set_firmware', { file: firmwareId, content: 'invalid Arduino source !!!' }); break;
        case 8: answer = requestCall('compile_firmware', {}); break;
        case 9: answer = requestCall('set_firmware', { file: firmwareId, content: blinkSource }); break;
        case 10: answer = requestCall('compile_firmware', {}); break;
        case 11: answer = requestCall('start_simulation', {}); break;
        case 12: answer = requestCall('get_build_result', {}); break;
        default: answer = { message: { role: 'assistant', content: 'The LED circuit was created, firmware compiled, and simulation started. The actual tool results confirm these operations.' }, model: 'browser-function-test' };
      }
      return route.fulfill({ json: answer });
    });
  }
  await page.goto(root);
  await page.getByRole('button', { name: 'Blink an LED', exact: true }).click();
  await page.waitForURL('**/editor');
  const assistant = page.locator('.wu-assistant');
  await assistant.getByLabel('Use project tools').check();
  await assistant.getByLabel('What would you like to build or fix?').fill(servo ? 'Build an Arduino servo sweep project.' : ultrasonic ? 'Build an ultrasonic distance measurement system using Arduino.' : 'Build an Arduino LED blink circuit. Use an external LED and 220 ohm resistor, compile firmware and run simulation.');
  await assistant.getByRole('button', { name: 'Ask Wireup', exact: true }).click();
  const deadline = Date.now() + 180000;
  while (await assistant.getByRole('button', { name: 'Cancel request' }).count()) {
    const confirmation = assistant.getByRole('button', { name: 'Allow change', exact: true });
    if (await confirmation.isVisible()) await confirmation.click();
    if (Date.now() > deadline) throw new Error('Build did not finish within the test deadline.');
    await page.waitForTimeout(100);
  }
  await expect(assistant.getByLabel('AI response').last()).toContainText(/./, { timeout: 10000 });
  const project = await page.evaluate(async () => (await import('/src/wireup/tools/index.ts')).get_project_state());
  expect(project.success).toBe(true);
  expect(project.data.snapshot.circuit.components.some(part => part.metadataId === (servo ? 'servo' : ultrasonic ? 'hc-sr04' : 'led'))).toBe(true);
  if (!ultrasonic && !servo) expect(project.data.snapshot.circuit.components.some(part => part.metadataId.startsWith('resistor'))).toBe(true);
  expect(project.data.snapshot.circuit.wires.length).toBeGreaterThanOrEqual(ultrasonic ? 4 : 3);
  await expect(assistant.getByLabel('Current prototype result')).toBeVisible();
  const build = await page.evaluate(async () => (await import('/src/wireup/tools/index.ts')).get_build_result());
  expect(build.data.compilation_result.success).toBe(true);
  expect(build.data.simulation_result.last_start.success).toBe(true);
  expect(build.data.build_instructions.some(step => step.instruction.includes(servo ? '.PWM' : ultrasonic ? '.TRIG' : '.A'))).toBe(true);
  const simulation = await page.evaluate(async () => (await import('/src/wireup/tools/index.ts')).get_simulation_state());
  expect(simulation.data.running).toBe(true);
  expect(simulation.data.boards.some(board => board.program_loaded)).toBe(true);
  const output = await page.evaluate(async () => (await import('/src/wireup/tools/index.ts')).get_serial_output());
  if (!live) { expect(toolResults).toHaveLength(servo ? 9 : ultrasonic ? 10 : 13); if (servo) expect(output.data.output).toContain('Servo ready'); else if (!ultrasonic) expect(output.data.output).toContain('AI blink circuit running'); else expect(output.data.output.trim().length).toBeGreaterThan(0); }
  await page.evaluate(async () => (await import('/src/wireup/tools/index.ts')).stop_simulation());
  await page.getByRole('button', { name: /Schematic/ }).click();
  await expect(page.locator('.wu-schematic')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  console.log(live ? 'PASS live model created and ran the actual LED blink project.' : 'PASS model-response fixture invoked actual Velxio actions: components, three wires, firmware, real compiler, real simulation and serial. Live model generation was not verified.');
} catch (error) { console.log('BUILD_FAILURE_SCREEN', await page.locator('.wu-assistant').innerText()); throw error; } finally { await browser.close(); }
