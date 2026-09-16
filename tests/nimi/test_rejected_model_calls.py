import json

import pytest

from deeptutor.nimi.llm import model_request
from deeptutor.runtime.agentic.labeled_step import LabeledStepResult
from deeptutor.runtime.agentic.loop import LabelProtocol, run_agentic_loop
from deeptutor.runtime.stream_bus import StreamBus


@pytest.mark.asyncio
@pytest.mark.parametrize("draft", ["Inspect the source first.", ""])
async def test_repair_closes_rejected_real_calls_without_dispatch_or_continuity_loss(
    monkeypatch, draft
):
    tools = [
        {"type": "function", "function": {"name": name, "parameters": {"type": "object"}}}
        for name in ["kb_files", "rag"]
    ]
    calls = [
        {"id": "call-1", "name": "kb_files", "arguments": {}},
        {"id": "call-2", "name": "rag", "arguments": {"query": "attention"}},
    ]
    outputs = [
        {"type": "text", "text": "``THINK``\n" + draft},
        {
            "type": "reasoning-continuity",
            "carrier": {"kind": "test-opaque", "version": 1, "payload": [0, 255, 128]},
        },
        *[{"type": "tool-call", "toolCall": call} for call in calls],
    ]
    requests = []

    async def step(**kwargs):
        requests.append(list(kwargs["messages"]))
        if len(requests) == 1:
            return LabeledStepResult(
                label="THINK",
                text=draft,
                tool_calls=calls,
                nimi_state={"output_items": outputs, "tools": tools},
            )
        return LabeledStepResult(label="FINISH", text="A valid final answer.", tool_calls=[])

    monkeypatch.setattr("deeptutor.runtime.agentic.loop.run_labeled_step", step)

    class Host:
        final = None

        async def guard_context_window(self, messages):
            pass

        def build_iteration_trace_meta(self, iteration):
            return {"iter": iteration}, {"iter": iteration}

        async def dispatch_tools(self, **kwargs):
            raise AssertionError("A protocol-rejected call must never execute")

        def protocol_retry_notice(self):
            return "Retry the step."

        def protocol_repair_message(self, violation):
            return "THINK cannot execute tools. Use the TOOL label for a tool step."

        async def emit_final(self, text, final_meta):
            self.final = text

    host = Host()
    await run_agentic_loop(
        initial_messages=[{"role": "user", "content": "Create one question."}],
        protocol=LabelProtocol(
            allowed=("THINK", "TOOL", "FINISH"),
            intermediate=frozenset({"THINK"}),
            terminal=frozenset({"FINISH"}),
            final=frozenset({"FINISH"}),
            tool_label="TOOL",
        ),
        client=object(),
        model="text.generate",
        completion_kwargs={},
        tool_schemas=tools,
        binding="nimi",
        stream=StreamBus(),
        source="question",
        stage="exploring",
        max_iterations=3,
        host=host,
    )
    assert host.final == "A valid final answer."
    repaired = requests[1]
    assert repaired[1]["_provider_response_state"]["nimi_state"]["output_items"] == outputs
    assert [message["tool_call_id"] for message in repaired[2:4]] == ["call-1", "call-2"]
    assert all(
        message["is_error"] and json.loads(message["content"])["executed"] is False
        for message in repaired[2:4]
    )
    mapped, _ = model_request(repaired, tools=tools)
    assert [
        message["turnItems"][0]["toolResult"]["toolCallId"] for message in mapped["messages"][2:4]
    ] == ["call-1", "call-2"]
    assert all(
        message["turnItems"][0]["toolResult"]["isError"] for message in mapped["messages"][2:4]
    )
    final_request, _ = model_request(repaired, tools=None)
    assert final_request["toolChoice"] == "none"
