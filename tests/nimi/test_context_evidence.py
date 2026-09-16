from copy import deepcopy
from types import SimpleNamespace

import pytest

from deeptutor.agents.loop.pipeline import AgenticLoopPipeline
from deeptutor.runtime.stream_bus import StreamBus
from deeptutor.services.llm.exceptions import LLMProviderError


def pipeline():
    return SimpleNamespace(
        llm_config=SimpleNamespace(context_window=100),
        model="text.generate",
        _estimate_messages_tokens=lambda messages: sum(len(m.get("content", "")) for m in messages),
        _tool_result_snip_marker=lambda: "[compacted]",
        _t=lambda *args, **kwargs: "Compacted old evidence",
        event_source="chat",
        event_stage="responding",
    )


@pytest.mark.asyncio
async def test_budget_evicts_old_tool_data_without_erasing_latest_batch_or_continuity():
    state = {
        "nimi_state": {
            "output_items": [
                {
                    "type": "reasoning-continuity",
                    "carrier": {"kind": "opaque", "version": 1, "payload": [0, 255]},
                }
            ],
            "tools": [],
        }
    }
    messages = [
        {"role": "system", "content": "Rules"},
        {"role": "assistant", "content": "Old", "_provider_response_state": deepcopy(state)},
        {"role": "tool", "tool_call_id": "older", "content": "a" * 60},
        {"role": "assistant", "content": "New", "_provider_response_state": deepcopy(state)},
        {"role": "tool", "tool_call_id": "new", "content": "b" * 40},
    ]
    await AgenticLoopPipeline._guard_context_window(pipeline(), messages, StreamBus())
    assert messages[2]["content"] == "[compacted]"
    assert messages[4] == {"role": "tool", "tool_call_id": "new", "content": "b" * 40}
    assert (
        messages[1]["_provider_response_state"] == messages[3]["_provider_response_state"] == state
    )


@pytest.mark.asyncio
async def test_insufficient_working_budget_fails_with_fresh_evidence_intact():
    messages = [
        {"role": "system", "content": "s" * 95},
        {"role": "assistant", "content": "Read"},
        {"role": "tool", "tool_call_id": "new", "content": "Original table values"},
    ]
    original = deepcopy(messages)
    with pytest.raises(LLMProviderError, match="App conversation budget"):
        await AgenticLoopPipeline._guard_context_window(pipeline(), messages, StreamBus())
    assert messages == original
