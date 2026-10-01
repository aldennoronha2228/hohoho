from app.services import ai_chat
from app.services.ai_chat import ChatSettings, ChatError
import pytest


def test_reads_backend_env_without_exporting_key(monkeypatch):
    for name in ('AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(ai_chat, 'dotenv_values', lambda path: {'AI_API_KEY': 'test-private-key', 'AI_BASE_URL': 'https://provider.example/v1', 'AI_MODEL': 'test-model'})
    config = ChatSettings.from_env()
    assert config.configured
    assert config.model == 'test-model'
    assert 'test-private-key' not in repr(config)


def test_process_values_take_precedence(monkeypatch):
    monkeypatch.setattr(ai_chat, 'dotenv_values', lambda path: {'AI_MODEL': 'local-model'})
    monkeypatch.setenv('AI_API_KEY', 'test-key')
    monkeypatch.setenv('AI_BASE_URL', 'https://provider.example/v1')
    monkeypatch.setenv('AI_MODEL', 'process-model')
    assert ChatSettings.from_env().model == 'process-model'


def test_reports_exact_missing_provider_settings(monkeypatch):
    for name in ('AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(ai_chat, 'dotenv_values', lambda path: {'AI_API_KEY': 'secret', 'AI_BASE_URL': '', 'AI_MODEL': ''})
    with pytest.raises(ChatError) as failure:
        ChatSettings.from_env()
    assert 'AI_BASE_URL, AI_MODEL' in failure.value.detail
    assert 'secret' not in failure.value.detail
