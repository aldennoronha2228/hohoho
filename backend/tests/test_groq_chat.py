import asyncio
import json
import httpx
from app.services.ai_chat import ChatSettings, OpenAICompatibleChatProvider, TurnUserMessage


def test_tool_only_groq_message_can_omit_content():
    def provider(request):
        return httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'tool_calls': [{'id': 'groq_call', 'type': 'function', 'function': {'name': 'get_project_state', 'arguments': '{}'}}]}, 'finish_reason': 'tool_calls'}]})
    client = OpenAICompatibleChatProvider(ChatSettings(api_key='test-key'), transport=httpx.MockTransport(provider))
    result = asyncio.run(client.turn([TurnUserMessage(role='user', content='Inspect project')]))
    assert result.message.content is None
    assert result.message.tool_calls[0].function.name == 'get_project_state'


def test_groq_throttle_is_retried_once_without_unbounded_requests(monkeypatch):
    calls = []
    def provider(request):
        calls.append(json.loads(request.content))
        if len(calls) == 1:
            return httpx.Response(429, headers={'retry-after': '1'})
        return httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'content': 'Hello'}, 'finish_reason': 'stop'}]})
    async def sleep(delay): assert delay == 1
    monkeypatch.setattr(asyncio, 'sleep', sleep)
    client = OpenAICompatibleChatProvider(ChatSettings(api_key='test-key', base_url='https://api.groq.com/openai/v1'), transport=httpx.MockTransport(provider))
    result = asyncio.run(client.turn([TurnUserMessage(role='user', content='Hello')]))
    assert result.message.content == 'Hello'
    assert len(calls) == 2
