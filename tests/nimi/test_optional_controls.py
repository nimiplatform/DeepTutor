import pytest
from deeptutor.nimi.llm import NimiLLMProvider


@pytest.mark.asyncio
async def test_runtime_defaults_are_unset_but_explicit_task_controls_survive(monkeypatch):
    sent = []
    class Transport:
        async def events(self, operation, payload):
            sent.append(payload)
            yield {"kind": "result", "value": {"text": "Actual boundary result", "toolCalls": [], "outputItems": [{"type": "text", "text": "Actual boundary result"}], "finishReason": "stop"}}
    monkeypatch.setattr("deeptutor.nimi.llm.get_transport", lambda: Transport())
    provider = NimiLLMProvider()
    await provider.chat_with_retry([{"role": "user", "content": "Question"}])
    await provider.chat_with_retry([{"role": "user", "content": "Question"}], max_tokens=4096, temperature=0.7)
    assert sent[0]["parameters"] == {}
    # Values equal to historical defaults still remain explicit controls.
    assert sent[1]["parameters"] == {"maxTokens": 4096, "temperature": 0.7}
