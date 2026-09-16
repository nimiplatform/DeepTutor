from copy import deepcopy
from types import SimpleNamespace

import pytest

from deeptutor.agents.loop.context_budget import (
    LLMRequestSnapshot,
    build_nimi_working_budget,
    resolve_nimi_working_budget,
    working_set_total,
)
from deeptutor.agents.loop.pipeline import AgenticLoopPipeline
from deeptutor.runtime.stream_bus import StreamBus
from deeptutor.services.llm.exceptions import AppContextBudgetExceeded


def test_observed_research_request_fits_the_finite_default():
    total, margin = working_set_total(21114, 8000)
    assert (total, margin) == (31226, 2112)
    assert total <= 32768
    assert resolve_nimi_working_budget(SimpleNamespace(context_window=16000)) == 16000


def test_public_replay_is_counted_once_and_opaque_tokens_remain_unknown():
    plain = LLMRequestSnapshot(
        messages=[
            {"role": "user", "content": "Question"},
            {"role": "assistant", "content": "Original output"},
        ],
        output_token_limit=8000,
    )
    state = {
        "output_items": [{"type": "text", "text": "Original output"}],
        "tools": [
            {"type": "function", "function": {"name": "unused", "description": "huge" * 1000}}
        ],
    }
    replay = LLMRequestSnapshot(
        messages=[
            plain.messages[0],
            {"role": "assistant", "content": "Cleaned display " * 1000, "_nimi_state": state},
        ],
        output_token_limit=8000,
    )
    original = deepcopy(replay.messages)
    a = build_nimi_working_budget(blocks=[], request=plain, budget=32768)
    b = build_nimi_working_budget(blocks=[], request=replay, budget=32768)
    assert a["input_tokens"] == b["input_tokens"]
    assert b["tool_count"] == 0 and replay.messages == original
    state["output_items"].append(
        {
            "type": "reasoning-continuity",
            "carrier": {"kind": "opaque", "version": 1, "payload": [0, 255, 128] * 100},
        }
    )
    c = build_nimi_working_budget(blocks=[], request=replay, budget=32768)
    assert c["input_tokens"] == b["input_tokens"]
    assert c["opaque_model_tokens"] is None and c["opaque_transport_bytes"] == 300
    assert c["transport_bytes"] > b["transport_bytes"]


@pytest.mark.asyncio
async def test_guard_and_readout_share_actual_output_cap_and_preserve_new_results():
    host = AgenticLoopPipeline.__new__(AgenticLoopPipeline)
    host.binding = "nimi"
    host.llm_config = SimpleNamespace(working_context_budget=32768, max_tokens=4096)
    host._last_prompt_blocks = []
    host._tool_result_snip_marker = lambda: "[older data compacted]"
    tool = {"type": "function", "function": {"name": "rag", "parameters": {"type": "object"}}}
    messages = [
        {"role": "user", "content": "Read source"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [{"id": "source-1", "function": {"name": "rag", "arguments": "{}"}}],
        },
        {"role": "tool", "tool_call_id": "source-1", "content": "Actual source evidence"},
    ]
    request = LLMRequestSnapshot(
        messages=list(messages), tool_schemas=[tool], output_token_limit=8000
    )
    measured = host.measure_context_budget(request)
    assert measured["output_token_limit"] == 8000
    assert measured["used_tokens"] == sum(s["tokens"] for s in measured["segments"])
    await host._guard_context_window(messages, StreamBus(), request=request)
    assert host.measure_context_budget(request) == measured
    host.llm_config.working_context_budget = 5000
    before = deepcopy(messages)
    with pytest.raises(AppContextBudgetExceeded) as exc:
        await host._guard_context_window(messages, StreamBus(), request=request)
    assert exc.value.used == measured["used_tokens"]
    assert messages == before


def test_actual_output_cap_is_required():
    with pytest.raises(ValueError, match="actual output cap"):
        build_nimi_working_budget(blocks=[], request=LLMRequestSnapshot(), budget=32768)
