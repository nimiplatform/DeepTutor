import json

import pytest

from deeptutor.nimi.llm import model_request
from deeptutor.services.embedding.client import EmbeddingClient, embedding_batches
from deeptutor.services.embedding.config import EmbeddingConfig
from deeptutor.services.session.provider_response_state import normalize_provider_response_state


def test_ordered_tool_outputs_continuity_and_results_survive_replay():
    tool = {
        "type": "function",
        "function": {"name": "read_source", "parameters": {"type": "object"}},
    }
    outputs = [
        {"type": "text", "text": "查阅资料"},
        {
            "type": "reasoning-continuity",
            "carrier": {"kind": "opaque-test", "version": 1, "payload": [0, 255, 128, 10]},
        },
        {
            "type": "tool-call",
            "toolCall": {"id": "call-1", "name": "read_source", "arguments": {"page": 3}},
        },
    ]
    state = normalize_provider_response_state(
        {"nimi_state": {"output_items": outputs, "tools": [tool]}}
    )
    state = json.loads(json.dumps(state, ensure_ascii=False))
    request, declarations = model_request(
        [
            {"role": "user", "content": "解释第三页"},
            {"role": "assistant", "content": "已清理的显示文本", "_provider_response_state": state},
            {"role": "tool", "tool_call_id": "call-1", "content": "资料原文与出处"},
        ]
    )
    assert [item["output"] for item in request["messages"][1]["turnItems"]] == outputs
    assert request["messages"][2]["turnItems"][0]["toolResult"] == {
        "toolCallId": "call-1",
        "toolName": "read_source",
        "result": "资料原文与出处",
        "isError": False,
    }
    assert declarations == [tool]


def test_checkpoint_compacts_tool_data_without_losing_correlation_or_continuity():
    from deeptutor.agents.loop.agent_loop import AgentLoop
    from deeptutor.runtime.agentic.tool_dispatch import DispatchOutcome

    outputs = [
        {
            "type": "reasoning-continuity",
            "carrier": {"kind": "opaque", "version": 1, "payload": [0, 255]},
        },
        *[
            {"type": "tool-call", "toolCall": {"id": name, "name": name, "arguments": {}}}
            for name in ("lookup", "finish")
        ],
    ]
    tools = [
        {"type": "function", "function": {"name": name, "parameters": {"type": "object"}}}
        for name in ("lookup", "finish")
    ]
    result = {"role": "tool", "tool_call_id": "finish", "content": '{"all_done":true}'}
    messages = [
        {"role": "system", "content": "Solve"},
        {"role": "user", "content": "Question"},
        {"role": "assistant", "_nimi_state": {"output_items": outputs, "tools": tools}},
        {
            "role": "tool",
            "tool_call_id": "lookup",
            "content": "material " * 10000,
            "is_error": False,
        },
        result,
    ]
    dispatch = DispatchOutcome(
        tool_messages=[result],
        tool_metadata_by_id={
            "finish": {"_context_checkpoint": {"summary": "Verified roots 2 and 3."}}
        },
    )
    assert AgentLoop._fold_context_checkpoints(messages, dispatch, 2) == 5
    assert messages[2]["_nimi_state"]["output_items"] == outputs
    assert messages[3]["tool_call_id"] == "lookup"
    assert len(messages[3]["content"]) < 256
    assert "Verified roots 2 and 3" in result["content"]
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "tool", "tool"]
    replay, _ = model_request(messages)
    assert [m["turnItems"][0]["toolResult"]["toolCallId"] for m in replay["messages"][3:]] == [
        "lookup",
        "finish",
    ]
    assert replay["messages"][2]["turnItems"][0]["output"]["carrier"]["payload"] == [0, 255]


def test_embedding_batches_respect_utf8_and_item_limits():
    assert list(map(len, embedding_batches(["资料"] * 17))) == [16, 1]
    assert list(map(len, embedding_batches(["中" * 10922] * 3))) == [2, 1]
    with pytest.raises(ValueError, match="32 KiB"):
        embedding_batches(["中" * 10923])


@pytest.mark.asyncio
async def test_embedding_rejects_a_changed_space_before_returning_partial_vectors(monkeypatch):
    class Host:
        calls = 0

        async def request(self, operation, value):
            self.calls += 1
            assert operation == "embedding.batch"
            return {
                "vectors": [[1.0, 2.0] for _ in value["inputs"]],
                "spaceId": "original" if self.calls == 1 else "changed",
            }

    host = Host()
    monkeypatch.setattr("deeptutor.services.embedding.client.get_transport", lambda: host)
    client = EmbeddingClient(
        EmbeddingConfig(model="text.embed", api_key="", binding="nimi", dim=2, space_id="original")
    )
    with pytest.raises(ValueError, match="space changed"):
        await client.embed(["资料"] * 17)
    assert host.calls == 2


@pytest.mark.asyncio
@pytest.mark.real_llm_resolver
async def test_factory_and_agentic_client_use_the_same_typed_host(monkeypatch):
    class Host:
        requests = []

        async def events(self, operation, value):
            self.requests.append((operation, value))
            yield {"kind": "delta", "value": {"text": "学习回答"}}
            yield {
                "kind": "result",
                "value": {
                    "text": "学习回答",
                    "finishReason": "stop",
                    "toolCalls": [],
                    "outputItems": [{"type": "text", "text": "学习回答"}],
                },
            }

    host = Host()
    monkeypatch.setattr("deeptutor.nimi.llm.get_transport", lambda: host)
    from deeptutor.runtime.agentic.client import LLMClientConfig, build_openai_client
    from deeptutor.services.llm.factory import complete

    assert await complete("中文问题") == "学习回答"
    client = build_openai_client(
        LLMClientConfig(binding="nimi", model="text.generate", api_key=None, base_url=None)
    )
    stream = await client.chat.completions.create(
        model="text.generate", messages=[{"role": "user", "content": "另一题"}], stream=True
    )
    chunks = [chunk async for chunk in stream]
    assert chunks[-1].choices[0].finish_reason == "stop"
    assert chunks[-1].choices[0].provider_specific_fields["nimi_state"]["output_items"] == [
        {"type": "text", "text": "学习回答"}
    ]
    assert [operation for operation, _ in host.requests] == ["text.step", "text.step"]
    assert all(set(request) <= {"messages", "parameters"} for _, request in host.requests)


@pytest.mark.asyncio
@pytest.mark.real_llm_resolver
async def test_length_terminal_reaches_only_callers_with_a_continuation_policy(monkeypatch):
    from deeptutor.nimi.llm import NimiLLMProvider

    class Host:
        closed = False

        async def events(self, operation, value):
            try:
                yield {
                    "kind": "result",
                    "value": {
                        "text": "An incomplete explanation",
                        "finishReason": "length",
                        "toolCalls": [],
                        "outputItems": [{"type": "text", "text": "An incomplete explanation"}],
                    },
                }
            finally:
                self.closed = True

    host = Host()
    monkeypatch.setattr("deeptutor.nimi.llm.get_transport", lambda: host)
    result = await NimiLLMProvider().chat([{"role": "user", "content": "Explain"}])
    assert result.finish_reason == "length"
    assert host.closed
    from deeptutor.services.llm.exceptions import LLMProviderError
    from deeptutor.services.llm.factory import complete, stream

    with pytest.raises(LLMProviderError, match="before completing"):
        await complete("Produce the entire result")
    with pytest.raises(LLMProviderError, match="before completing"):
        _ = [chunk async for chunk in stream("Produce the entire result")]


@pytest.mark.asyncio
async def test_memory_model_failure_is_not_replayed_or_saved_as_an_empty_edit(monkeypatch):
    from deeptutor.nimi.transport import NimiRequestError
    from deeptutor.services.memory.consolidator.modes import _runtime

    failure = NimiRequestError(
        {"message": "Model step interrupted", "reasonCode": "AI_TEXT_OUTPUT_INCOMPLETE"}
    )

    async def broken_stream(**kwargs):
        yield "partial"
        raise failure

    async def forbidden_retry(**kwargs):
        raise AssertionError("Nimi interruption may not trigger an implicit alternate call")

    events = []

    async def observe(event):
        events.append(event)

    monkeypatch.setattr(_runtime, "llm_stream", broken_stream)
    monkeypatch.setattr(_runtime, "llm_complete", forbidden_retry)
    with pytest.raises(NimiRequestError) as raised:
        await _runtime.call_llm(
            system_prompt="Remember", user_prompt="A learning note", on_event=observe
        )
    assert raised.value is failure
    assert events[-1]["stage"] == "llm_io_end" and events[-1]["error"]
