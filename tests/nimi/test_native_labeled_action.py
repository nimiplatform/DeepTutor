import pytest

from deeptutor.runtime.agentic.client import LLMClientConfig, build_openai_client
from deeptutor.runtime.agentic.labeled_step import run_labeled_step
from deeptutor.runtime.agentic.loop import LabelProtocol, _protocol_violation
from deeptutor.runtime.stream_bus import StreamBus


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body,native,expected_label,violation",
    [
        ("", True, "TOOL", None),
        ("``THINK``\nI should consult the source.", True, "THINK", "think_with_tools"),
        ('``TOOL``\n```json\n{"query":"Table 3"}\n```', False, "TOOL", "tool_without_calls"),
    ],
)
async def test_native_action_requires_successful_typed_call_without_conflicting_text(
    monkeypatch, body, native, expected_label, violation
):
    call = {
        "id": "real-call-id",
        "name": "rag",
        "arguments": {"query": "Table 3", "kb_name": "paper"},
    }
    outputs = ([{"type": "text", "text": body}] if body else []) + (
        [{"type": "tool-call", "toolCall": call}] if native else []
    )
    requests = []

    class Host:
        async def events(self, operation, value):
            requests.append(value)
            if body:
                yield {"kind": "delta", "value": {"text": body}}
            yield {
                "kind": "result",
                "value": {
                    "text": body,
                    "outputItems": outputs,
                    "toolCalls": [call] if native else [],
                    "finishReason": "tool-calls" if native else "stop",
                },
            }

    monkeypatch.setattr("deeptutor.nimi.llm.get_transport", lambda: Host())
    client = build_openai_client(
        LLMClientConfig(binding="nimi", model="text.generate", api_key=None, base_url=None)
    )
    tools = [{"type": "function", "function": {"name": "rag", "parameters": {"type": "object"}}}]
    protocol = LabelProtocol(
        allowed=("THINK", "TOOL", "FINISH"),
        intermediate=frozenset({"THINK"}),
        terminal=frozenset({"FINISH"}),
        final=frozenset({"FINISH"}),
        tool_label="TOOL",
    )
    result = await run_labeled_step(
        client=client,
        model="text.generate",
        messages=[{"role": "user", "content": "Read Table 3"}],
        completion_kwargs={"tool_choice": {"type": "function", "function": {"name": "rag"}}},
        tool_schemas=tools,
        allowed_labels=protocol.allowed,
        final_labels=protocol.final,
        tool_label="TOOL",
        stream=StreamBus(),
        source="research",
        stage="researching",
        iter_meta={"call_id": "test"},
        binding="nimi",
    )
    assert result.label == expected_label
    assert _protocol_violation(result, protocol) == violation
    assert result.nimi_state["output_items"] == outputs
    assert result.nimi_state["tools"] == (tools if native else [])
    assert requests[0]["toolChoice"] == {"type": "tool", "name": "rag"}
    if not body:
        assert result.text == ""  # No synthesized model label/prose.
        assert result.tool_calls[0]["id"] == call["id"]
