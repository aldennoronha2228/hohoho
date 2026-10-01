# Wireup AI chat and project tools

The existing Assistant UI uses a new modular Chat Completions backend. It does not use the legacy Wireup proposal pipeline, apply/reject UI, or a multi-agent framework. The old modules remain compatibility code but are not imported by the current chat.

## Server configuration

```dotenv
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

Use a provider/model supporting OpenAI-compatible Chat Completions and function calling. The backend appends `/chat/completions`. Native Responses API URLs are not interchangeable. Keys are server-side and never returned to the browser or embedded in `VITE_*` values.

Set these environment variables in the terminal that starts uvicorn, or load the optional `backend/.env` explicitly:

```powershell
cd backend
./venv/Scripts/python.exe -m uvicorn app.main:app --env-file .env --host 127.0.0.1 --port 8001
```

Docker Compose already passes its optional `backend/.env` to the service. Configuration status confirms settings only, not credentials, quota, model access, or connectivity. Provider charges/data policies apply.

## Build conversation page

Submitting the home prompt opens `/build`, a full conversation workspace with the existing sidebar. The configured model generates ten project-specific multiple-choice questions through `/api/ai/chat/questions`. Select Prepare project questions, answer each question, then Start generating. Questions are not a fixed checklist; the original request and selected labels are included in the build message. Editing the request invalidates old questions. Invalid provider output or missing configuration produces an error instead of fabricated fallback questions. **Start generating** sends the request plus answers to the existing model/tool loop. **Conversation** and **Circuit & firmware** switch views of the same project; the existing editor is mounted for real tool execution. Destructive changes still require approval. No hidden reasoning or simulated activity is displayed.

A request is capped at 15 tool operations, including resumed operations. Larger projects may require a follow-up. Rate-limited provider calls can be resumed without silently replaying completed tool changes. Groq requests use verified system certificate trust and a bounded throttling retry; quota exhaustion remains a provider error.

## Flow

Plain chat uses `POST /api/ai/chat`. It sends only conversation text, not circuit files, and cannot execute actions.

In Editor, enable **Use project tools** to authorize operations on the current project. The user message goes to `POST /api/ai/chat/turn`. One model receives the fixed function definitions and returns either text or structured tool calls. The browser executes calls sequentially through `executeWireupTool`, appends their actual `{success,data}` or `{success:false,error}` results, and asks the same model for the next response.

The backend does not mutate browser state. The model does not receive Zustand handles. There is no separate circuit or simulation engine, no old proposal architecture, and no physical flashing tool.

## Live capabilities

- Project/circuit inspection, actual component catalog, exact rendered pins.
- Add/remove components and boards; update validated component properties.
- Connect/disconnect pins and update connection endpoints using existing routing/history.
- Read/update existing firmware and add safe files to existing editor groups.
- Compile the active target using the existing compiler, start the existing simulator, stop running boards, and read actual simulation/serial state.

Circuit creation/update is incremental through these existing operations, not a second circuit representation. Firmware generation happens through the model's file-content arguments and real editor writes, not a starter-code mock.

Tool-controlled MicroPython loading remains explicitly unsupported until its loader has a safe cancellation boundary; existing UI controls are unchanged. A successful start reports existing running state, not physical verification or completion of a remote Linux boot.

## Progressive activity and confirmations

The existing Assistant displays expandable activity grouped into Project, Circuit, Firmware, Simulation, and Build guide. Every row comes from an actual requested tool and its execution result. Running indicators appear only while that call is pending; success and errors come from the adapter result. A simulation start is labeled **Simulation started**, not **Simulation completed**. Arguments and full results are available in each row's details.

Normal additive build actions execute automatically after project tools are enabled. Removing a component, disconnecting a wire, changing an existing connection, and replacing substantial original firmware require **Allow change** or **Reject change**. Rejecting sends a failure result to the model without executing that action. Code already authored in the same turn can be debugged without repeated confirmations. Project replacement is not exposed as a tool. Existing recorded component/wire undo actions are retained.

## Safeguards

- Project tools are opt-in and available in Editor; plain chat remains the default.
- Tool names and argument schemas are fixed on the server and validated again by browser adapters.
- Calls execute sequentially with a maximum of 15 operations per user turn (including resumed calls) and three compilation/start attempts per turn.
- Existing mutation guards reject edits while running/busy; invalid pins/files/properties and duplicates return errors.
- Changed project identity or edits while the model is responding stop execution; pending compilation/start uses the tool runtime's existing revision/stop guards.
- Cancellation stops further calls and requests simulation stop. Completed component/file/wire changes are retained, not silently rolled back. Backend/provider work may continue after cancellation.
- The UI displays calls and actual results. The model is instructed to claim success only for successful tool results; model text is still not a hardware certification.
- Build conversations and actual tool activity are saved per local project in IndexedDB and can be reopened through History or Open saved conversation. Interrupted running activities restore as cancelled, never as successful. Project state is saved before generation; failures block startup. No cloud conversation storage is introduced.

## Complete prototype workflow

The same model is instructed to inspect requirements and the available catalog, create the circuit and firmware through tools, compile, fix actual compiler errors (up to two retries), start simulation, inspect actual state/serial output, and request `get_build_result` before its final answer. Simulation issues can be corrected only after stopping the simulator. Unsupported components or unresolved errors must be disclosed.

The Assistant's **Current prototype** panel reuses the existing Build pack derivation: overview, component quantities and catalog purposes, pin-to-pin wiring, actual firmware, numbered assembly steps, and revision-matched compilation/start evidence plus current serial output. It follows live edits; editing relevant inputs invalidates old compilation evidence. It is not physical hardware verification or a new circuit representation.

## Checks

```powershell
# From backend/, with pytest installed
./venv/Scripts/python.exe -m pytest tests/test_ai_chat.py tests/test_ai_tools.py -q

# From frontend/, with both dev servers running and Chrome installed
node scripts/wireup-chat.mjs
node scripts/wireup-ai-project.mjs
$env:WIREUP_TEST_PROJECT='ultrasonic'
node scripts/wireup-ai-project.mjs
```

Default browser tests use controlled model responses but execute real component, wire, file, compiler and simulator actions. They explicitly do not establish live LLM behavior. To run against your configured real model:

```powershell
$env:WIREUP_CHAT_LIVE='1'
node scripts/wireup-chat.mjs
node scripts/wireup-ai-project.mjs
```

The live project check submits an Arduino LED blink request and asserts real parts, at least three connections, loaded firmware and a running simulator. It incurs provider usage and changes its isolated browser project.

Current environment has no `AI_API_KEY`, so live model response/generation verification is blocked. No fake provider response is used as a production fallback.
