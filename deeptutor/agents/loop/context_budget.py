"""Per-turn accounting of what the chat loop put in the model's context window.

The composer surfaces "how full is the window, and what is filling it". Those
numbers only mean something if they describe the request the provider actually
received, so everything here measures *already-assembled* material — the
:class:`PromptBlock` list that produced the system prompt string, the tool
schemas that went into the call kwargs, and the final call's message list.
Re-deriving any of it would let the readout drift from what was sent.

The public entry point never raises: a context readout is an informational
extra and must never sink a turn.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
import json
import logging
import math
from typing import Any

from deeptutor.capabilities.protocol import PromptBlock
from deeptutor.services.llm.context_window import (
    coerce_positive_int,
    resolve_effective_context_window,
)

logger = logging.getLogger(__name__)

TokenCounter = Callable[[str], int]

#: ``PromptBlock.name`` -> segment key. The general/runtime_policy/loop trio is
#: the loop's fixed preamble and reads as one line to a user; every other named
#: block earns its own. Names absent here are capability playbooks, which are
#: summed under ``capability``.
_BLOCK_SEGMENTS: dict[str, str] = {
    "general": "system_prompt",
    "runtime_policy": "system_prompt",
    "loop": "system_prompt",
    "persona_style": "persona_style",
    "partner_turn_policy": "partner_turn_policy",
    "memory": "memory",
    "tools": "tool_manifest",
    "knowledge_base_note": "knowledge_base_note",
    "skills": "skills",
    "sources": "sources",
    "extended_tools": "extended_tools",
    "notebooks": "notebooks",
    "workspace": "workspace",
}
_CAPABILITY_SEGMENT = "capability"


@dataclass(slots=True)
class LLMRequestSnapshot:
    """What one real provider call carried, captured at call time.

    ``messages`` must be a shallow copy: the loop appends to its own list every
    round, and the budget describes one request, not the list's end state.
    """

    messages: list[dict[str, Any]] = field(default_factory=list)
    tool_schemas: list[dict[str, Any]] = field(default_factory=list)
    output_token_limit: int | None = None


NIMI_DEFAULT_WORKING_BUDGET = 32_768


def resolve_nimi_working_budget(config: Any) -> int:
    """An App product budget, never inferred from a physical model name."""
    explicit = getattr(config, "working_context_budget", None)
    if explicit is None:
        explicit = getattr(config, "context_window", None)
    if explicit is None:
        from deeptutor.services.config.loader import get_chat_params

        try:
            explicit = get_chat_params().get("working_context_budget")
        except FileNotFoundError:
            explicit = None
    if explicit is None:
        return NIMI_DEFAULT_WORKING_BUDGET
    value = coerce_positive_int(explicit)
    if value is None:
        raise ValueError("App working_context_budget must be a positive integer.")
    return value


def working_set_total(input_tokens: int, output_limit: int) -> tuple[int, int]:
    margin = max(1024, math.ceil(input_tokens * 0.1))
    return input_tokens + output_limit + margin, margin


def build_nimi_working_budget(
    *,
    blocks: Sequence[PromptBlock],
    request: LLMRequestSnapshot,
    budget: int,
    counter: TokenCounter | None = None,
) -> dict[str, Any]:
    """Count the public request once, without interpreting opaque continuity.

    Message text/calls/results and sent schemas are estimated with cl100k_base;
    opaque payload contributes only transport bytes, never guessed model tokens.
    """
    from deeptutor.nimi.llm import model_request

    if request.output_token_limit is None:
        raise ValueError("A working-set estimate requires this call's actual output cap.")
    count = counter or _default_counter()
    projected, _ = model_request(
        request.messages, request.tool_schemas, maxTokens=request.output_token_limit
    )
    message_tokens = 0
    opaque_bytes = 0
    for message in projected["messages"]:
        for part in message.get("content", []):
            if part.get("type") == "text":
                message_tokens += count(part["text"])
        for item in message.get("turnItems", []):
            if item["type"] == "tool-result":
                value = item["toolResult"]
                result = value["result"]
                message_tokens += count(result if isinstance(result, str) else _dumps(result))
                message_tokens += count(_dumps({k: v for k, v in value.items() if k != "result"}))
            else:
                value = item["output"]
                if value["type"] in {"text", "reasoning-summary"}:
                    message_tokens += count(value["text"])
                elif value["type"] == "tool-call":
                    message_tokens += count(_dumps(value["toolCall"]))
                elif value["type"] == "reasoning-continuity":
                    opaque_bytes += len(value["carrier"]["payload"])
    base_system = request.messages[0] if request.messages else {}
    system_tokens = (
        count(str(base_system.get("content") or "")) if base_system.get("role") == "system" else 0
    )
    totals = _prompt_block_tokens(blocks, count)
    _merge(totals, {"system_prompt": max(0, system_tokens - sum(totals.values()))})
    _merge(totals, {"messages": max(0, message_tokens - system_tokens)})
    _merge(totals, _tool_schema_tokens(projected.get("tools", []), set(), count))
    input_tokens = sum(totals.values())
    used, margin = working_set_total(input_tokens, request.output_token_limit)
    totals["output_reserve"] = request.output_token_limit
    totals["safety_margin"] = margin
    wire_bytes = len(
        json.dumps(projected, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    return {
        "budget_kind": "app_working_set",
        "window": budget,
        "window_estimated": False,
        "tokens_estimated": True,
        "counter": detect_counter_name(),
        "model": "text.generate",
        "input_tokens": input_tokens,
        "output_token_limit": request.output_token_limit,
        "safety_margin": margin,
        "used_tokens": used,
        "free_tokens": max(0, budget - used),
        "opaque_transport_bytes": opaque_bytes,
        "opaque_model_tokens": None if opaque_bytes else 0,
        "transport_bytes": wire_bytes,
        "message_count": len(projected["messages"]),
        "tool_count": len(projected.get("tools", [])),
        "segments": [
            {"key": k, "tokens": v}
            for k, v in sorted(totals.items(), key=lambda item: (-item[1], item[0]))
            if v
        ],
    }


@dataclass(slots=True)
class ContextWindowInfo:
    """Effective window, plus whether it was guessed from the model name."""

    window: int
    estimated: bool


def resolve_window_info(
    *,
    context_window: Any = None,
    model: str = "",
    max_tokens: Any = None,
) -> ContextWindowInfo:
    """Resolve the turn's window and report how it was obtained.

    A configured window is used verbatim, deliberately NOT routed through
    :func:`resolve_effective_context_window`: that helper clamps to
    ``MAX_EFFECTIVE_CONTEXT_WINDOW`` because it sizes the *history planning*
    budget, where an over-large window is a liability. The readout has the
    opposite duty — it must show the same number the operator sees on the
    model's settings page, or one window reads as two figures in two places.

    Only the fallback branch shares the planner's model-name heuristic, and an
    absent or unparseable value is exactly what selects it, so the same probe
    decides both the window and the ``estimated`` flag.
    """
    configured = coerce_positive_int(context_window)
    if configured is not None:
        return ContextWindowInfo(window=configured, estimated=False)
    return ContextWindowInfo(
        window=resolve_effective_context_window(model=model, max_tokens=max_tokens),
        estimated=True,
    )


def detect_counter_name() -> str:
    """Name of the tokenizer ``count_tokens`` will actually use in this process.

    ``count_tokens`` swallows a missing or broken tiktoken and silently drops to
    a chars/4 estimate; probing the same import keeps the reported counter from
    claiming an accuracy the numbers do not have.
    """
    try:
        import tiktoken

        tiktoken.get_encoding("cl100k_base")
    except Exception:
        return "heuristic"
    return "cl100k_base"


def count_conversation_tokens(
    messages: Sequence[dict[str, Any]],
    counter: TokenCounter,
) -> int:
    """Tokens of a request's messages, minus the leading system prompt.

    The system prompt is itemized block by block, so counting it here as well
    would put it in the total twice.
    """
    total = 0
    for index, message in enumerate(messages):
        if index == 0 and message.get("role") == "system":
            continue
        total += _message_tokens(message, counter)
    return total


def build_context_budget(
    *,
    blocks: Sequence[PromptBlock],
    request: LLMRequestSnapshot,
    model: str = "",
    context_window: Any = None,
    max_tokens: Any = None,
    loaded_deferred_names: Iterable[str] = (),
    deferred_tool_count: int = 0,
    counter: TokenCounter | None = None,
) -> dict[str, Any] | None:
    """Break the turn's last real request down into context-window segments.

    Returns ``None`` — never raises — when anything about the measurement goes
    wrong, so the caller simply omits the field.
    """
    try:
        return _build(
            blocks=blocks,
            request=request,
            model=model,
            context_window=context_window,
            max_tokens=max_tokens,
            loaded_deferred_names=loaded_deferred_names,
            deferred_tool_count=deferred_tool_count,
            counter=counter or _default_counter(),
        )
    except Exception:
        logger.warning("context budget measurement failed", exc_info=True)
        return None


def _build(
    *,
    blocks: Sequence[PromptBlock],
    request: LLMRequestSnapshot,
    model: str,
    context_window: Any,
    max_tokens: Any,
    loaded_deferred_names: Iterable[str],
    deferred_tool_count: int,
    counter: TokenCounter,
) -> dict[str, Any]:
    block_totals = _prompt_block_tokens(blocks, counter)
    totals: dict[str, int] = {}
    _merge(totals, block_totals)
    _merge(totals, {"system_prompt": _render_overhead(request.messages, block_totals, counter)})
    _merge(totals, _tool_schema_tokens(request.tool_schemas, set(loaded_deferred_names), counter))
    _merge(totals, {"messages": count_conversation_tokens(request.messages, counter)})

    # Rank once, then derive both the emitted segments and the total from it,
    # so ``used_tokens == sum(segments[].tokens)`` holds by construction rather
    # than by re-reading the dicts that were just built.
    ranked = [
        (key, tokens)
        for key, tokens in sorted(totals.items(), key=lambda item: (-item[1], item[0]))
        if tokens > 0
    ]
    segments: list[dict[str, Any]] = [{"key": key, "tokens": tokens} for key, tokens in ranked]
    used = sum(tokens for _, tokens in ranked)
    window = resolve_window_info(
        context_window=context_window,
        model=model,
        max_tokens=max_tokens,
    )
    return {
        "window": window.window,
        "window_estimated": window.estimated,
        "used_tokens": used,
        "free_tokens": max(0, window.window - used),
        "model": model,
        # Probed, not derived from ``counter``: the parameter exists so tests can
        # inject a deterministic stand-in, and production always takes the
        # default, so the probe and the counter in use are the same thing there.
        "counter": detect_counter_name(),
        "deferred_tool_count": max(0, int(deferred_tool_count)),
        "segments": segments,
    }


def _prompt_block_tokens(
    blocks: Sequence[PromptBlock],
    counter: TokenCounter,
) -> dict[str, int]:
    totals: dict[str, int] = {}
    for block in blocks:
        content = (block.content or "").strip()
        if not content:
            continue  # the assembler's join drops empty blocks too
        key = _BLOCK_SEGMENTS.get(block.name, _CAPABILITY_SEGMENT)
        # Measure the rendered form: the "## name" heading ships with the block.
        totals[key] = totals.get(key, 0) + counter(f"## {block.name}\n{content}")
    return totals


def _render_overhead(
    messages: Sequence[dict[str, Any]],
    block_totals: dict[str, int],
    counter: TokenCounter,
) -> int:
    """Tokens the shipped system prompt carries beyond its blocks' own text.

    :meth:`ChatPromptAssembler.render` welds the blocks together with ``---``
    separators and appends the language directive, so the string that shipped
    is larger than the sum of its parts. Taking the difference against the
    message that actually went out keeps the readout tied to the request — a
    reimplementation of the joiner here would silently drift the next time its
    format changes.
    """
    if not messages:
        return 0
    head = messages[0]
    if head.get("role") != "system":
        return 0
    content = head.get("content")
    if not isinstance(content, str):
        return 0
    return max(0, counter(content) - sum(block_totals.values()))


def _tool_schema_tokens(
    schemas: Sequence[dict[str, Any]],
    loaded_deferred_names: set[str],
    counter: TokenCounter,
) -> dict[str, int]:
    """Split the sent schemas by origin: built-in registry vs deferred loader."""
    totals = {"system_tools": 0, "mcp_tools": 0}
    for schema in schemas:
        if not isinstance(schema, dict):
            continue
        key = "mcp_tools" if _schema_name(schema) in loaded_deferred_names else "system_tools"
        totals[key] += counter(_dumps(schema))
    return totals


def _message_tokens(message: dict[str, Any], counter: TokenCounter) -> int:
    total = 0
    content = message.get("content")
    if isinstance(content, str):
        total += counter(content)
    elif isinstance(content, list):
        # Multimodal parts: only text is countable here — image parts are billed
        # by the provider in units this counter cannot see.
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                total += counter(str(part.get("text") or ""))
    tool_calls = message.get("tool_calls")
    if isinstance(tool_calls, list) and tool_calls:
        # Requested tool calls stay in-conversation for the rest of the turn,
        # so their arguments occupy the window just like message text.
        total += counter(_dumps(tool_calls))
    return total


def _schema_name(schema: dict[str, Any]) -> str:
    function = schema.get("function")
    if isinstance(function, dict):
        return str(function.get("name") or "")
    return str(schema.get("name") or "")


def _merge(totals: dict[str, int], more: dict[str, int]) -> None:
    for key, tokens in more.items():
        totals[key] = totals.get(key, 0) + tokens


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _default_counter() -> TokenCounter:
    # Imported lazily: ``context_builder`` pulls in the agent base classes, and
    # a module-level import from an agents module would close a cycle.
    from deeptutor.services.session.context_builder import count_tokens

    return count_tokens


__all__ = [
    "ContextWindowInfo",
    "LLMRequestSnapshot",
    "TokenCounter",
    "build_context_budget",
    "count_conversation_tokens",
    "detect_counter_name",
    "resolve_window_info",
]
