"""Endpoint coverage using an in-memory OpenAI-compatible HTTP provider."""
import copy
import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.wireup_ai import router
from app.services import wireup_ai


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("WIREUP_AI_API_KEY", "server-secret")
    monkeypatch.setenv("WIREUP_AI_BASE_URL", "https://provider.test/v1")
    monkeypatch.setenv("WIREUP_AI_MODEL", "test-model")
    app = FastAPI()
    app.include_router(router, prefix="/api/wireup-ai")
    return TestClient(app)


@pytest.fixture
def request_body():
    return {
        "prompt": "Blink the LED and connect it",
        "project": {
            "revision": "r1", "active_group_id": "g1", "board": "arduino-uno", "language": "arduino",
            "files": [{"group_id": "g1", "name": "sketch.ino", "content": "void setup() {}"}],
            "components": [{"id": "uno", "kind": "arduino-uno", "pins": ["13", "GND"]},
                           {"id": "led", "kind": "led", "pins": ["A", "C"]}],
            "wires": [], "libraries": [],
        },
    }


def mock_provider(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(wireup_ai.httpx, "AsyncClient", lambda **kwargs: original(
        **kwargs, transport=httpx.MockTransport(handler),
    ))


def proposal():
    return {
        "explanation": "Review polarity and add a current limiting resistor before running.",
        "files": [{"op": "set_file", "group_id": "g1", "name": "sketch.ino", "content": "void setup() { pinMode(13, OUTPUT); }"}],
        "circuit": [{"op": "add_wire", "start": {"component_id": "uno", "pin_name": "13"},
                     "end": {"component_id": "led", "pin_name": "A"}, "color": "#22c55e"}],
    }


def success(data, finish="stop"):
    return httpx.Response(200, json={"choices": [{"finish_reason": finish, "message": {"content": json.dumps(data)}}]})


def test_real_provider_contract(client, request_body, monkeypatch):
    seen = []
    def handler(request):
        seen.append(request)
        payload = json.loads(request.content)
        assert request.headers["Authorization"] == "Bearer server-secret"
        assert str(request.url) == "https://provider.test/v1/chat/completions"
        assert payload["model"] == "test-model"
        assert json.loads(payload["messages"][1]["content"])["project"] == request_body["project"]
        return success(proposal())
    mock_provider(monkeypatch, handler)
    response = client.post("/api/wireup-ai/proposals", json=request_body)
    assert response.status_code == 200
    assert response.json()["revision"] == "r1"
    assert response.json()["circuit"][0]["end"]["pin_name"] == "A"
    assert len(seen) == 1


def test_missing_key_is_actionable_and_not_exposed(client, request_body, monkeypatch):
    assert "server-secret" not in client.get("/api/wireup-ai/config").text
    monkeypatch.delenv("WIREUP_AI_API_KEY")
    status = client.get("/api/wireup-ai/status").json()
    assert status["configured"] is False
    assert "WIREUP_AI_API_KEY" in status["message"]
    assert client.post("/api/wireup-ai/proposals", json=request_body).status_code == 503


@pytest.mark.parametrize("mutation", ["pin", "component", "file", "duplicate", "unknown_op", "truncated", "malformed", "protected"])
def test_invalid_provider_proposals_are_rejected(client, request_body, monkeypatch, mutation):
    data = proposal()
    if mutation == "pin":
        data["circuit"][0]["start"]["pin_name"] = "NOT_A_PIN"
    elif mutation == "component":
        data["circuit"][0]["start"]["component_id"] = "invented"
    elif mutation == "file":
        data["files"][0]["name"] = "../secret"
    elif mutation == "duplicate":
        data["circuit"].append(copy.deepcopy(data["circuit"][0]))
    elif mutation == "unknown_op":
        data["circuit"][0]["op"] = "run_shell"
    elif mutation == "protected":
        endpoint = {"component_id": "uno", "pin_name": "13"}
        request_body["project"]["wires"] = [{"id": "w1", "start": endpoint, "end": endpoint, "removable": False}]
        data["circuit"] = [{"op": "remove_wire", "wire_id": "w1"}]
    mock_provider(monkeypatch, lambda _: httpx.Response(200, text="not json") if mutation == "malformed" else success(data, "length" if mutation == "truncated" else "stop"))
    response = client.post("/api/wireup-ai/proposals", json=request_body)
    assert response.status_code == 502


@pytest.mark.parametrize("status, expected", [(401, 502), (403, 502), (429, 429), (500, 502), (302, 502)])
def test_provider_errors_are_sanitized(client, request_body, monkeypatch, status, expected):
    mock_provider(monkeypatch, lambda _: httpx.Response(status, text="server-secret private upstream error"))
    response = client.post("/api/wireup-ai/proposals", json=request_body)
    assert response.status_code == expected
    assert "server-secret" not in response.text


def test_timeout(client, request_body, monkeypatch):
    def handler(request):
        raise httpx.ReadTimeout("private details", request=request)
    mock_provider(monkeypatch, handler)
    assert client.post("/api/wireup-ai/proposals", json=request_body).status_code == 504


@pytest.mark.parametrize("mutation", ["prompt", "extra", "duplicate", "context"])
def test_request_validation(client, request_body, mutation):
    if mutation == "prompt":
        request_body["prompt"] = " " * 8001
    elif mutation == "extra":
        request_body["api_key"] = "client-key"
    elif mutation == "duplicate":
        request_body["project"]["components"].append(request_body["project"]["components"][0])
    else:
        request_body["project"]["files"] = [{"group_id": "g1", "name": f"{i}.ino", "content": "a" * 90000} for i in range(3)]
    assert client.post("/api/wireup-ai/proposals", json=request_body).status_code == 422


def test_request_and_response_size_bounds(client, request_body, monkeypatch):
    assert client.post("/api/wireup-ai/proposals", content=b"a" * (wireup_ai.MAX_BYTES + 1)).status_code == 413
    mock_provider(monkeypatch, lambda _: httpx.Response(200, content=b"a" * (wireup_ai.MAX_BYTES + 1)))
    assert client.post("/api/wireup-ai/proposals", json=request_body).status_code == 502
