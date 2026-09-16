"""Validation and redaction for provider-private response replay state."""

from __future__ import annotations

import json
from typing import Any

MAX_REASONING_CONTENT_CHARS = 64_000
MAX_RESPONSE_OUTPUT_ITEMS = 64
MAX_RESPONSE_OUTPUT_BYTES = 256 * 1024
MAX_THINKING_BLOCKS = 64
MAX_THINKING_BLOCK_BYTES = 256 * 1024

# These are the output item kinds emitted by the Responses API that the
# agentic loop can legitimately need on the next request.  In particular,
# function_call_output is an input item built from our own tool message and
# must never be accepted from persisted provider state.
_ALLOWED_RESPONSE_OUTPUT_TYPES = frozenset(
    {"reasoning", "message", "function_call", "web_search_call", "web_search"}
)
_PRIVATE_MESSAGE_METADATA_KEYS = frozenset({"provider_response_state"})


def _normalized_output_items(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) > MAX_RESPONSE_OUTPUT_ITEMS:
        return []

    normalized: list[dict[str, Any]] = []
    total_bytes = 0
    for item in value:
        if not isinstance(item, dict) or item.get("type") not in _ALLOWED_RESPONSE_OUTPUT_TYPES:
            return []
        try:
            encoded = json.dumps(
                item,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
            ).encode("utf-8")
            cloned = json.loads(encoded)
        except (TypeError, ValueError):
            return []
        total_bytes += len(encoded)
        if total_bytes > MAX_RESPONSE_OUTPUT_BYTES or not isinstance(cloned, dict):
            return []
        normalized.append(cloned)
    return normalized


def _normalized_thinking_blocks(value: Any) -> list[dict[str, Any]]:
    """Bound Anthropic's signed thinking blocks for persistence and replay.

    Only ``thinking`` blocks are accepted, and only with the two fields the
    provider replays. A block is useless without its signature, so one that
    lost it is dropped rather than sent back: Anthropic rejects an unsigned
    replay, which would turn a missing signature into a failed turn.
    """
    if not isinstance(value, list) or len(value) > MAX_THINKING_BLOCKS:
        return []
    normalized: list[dict[str, Any]] = []
    total_bytes = 0
    for item in value:
        if not isinstance(item, dict) or item.get("type") != "thinking":
            return []
        thinking = item.get("thinking")
        signature = item.get("signature")
        if not isinstance(thinking, str) or not isinstance(signature, str) or not signature:
            return []
        block = {"type": "thinking", "thinking": thinking, "signature": signature}
        try:
            encoded = json.dumps(
                block,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
            ).encode("utf-8")
        except (TypeError, ValueError):
            return []
        total_bytes += len(encoded)
        if total_bytes > MAX_THINKING_BLOCK_BYTES:
            return []
        normalized.append(block)
    return normalized


def normalize_provider_response_state(value: Any) -> dict[str, Any] | None:
    """Return bounded, JSON-safe provider state suitable for persistence/replay."""
    if not isinstance(value, dict):
        return None

    normalized: dict[str, Any] = {}
    nimi_state = value.get("nimi_state")
    if nimi_state is not None:
        # Preserve Runtime-issued bytes and output order as private App replay
        # state. Invalid state is a storage error, never a reason to drop it.
        if not isinstance(nimi_state, dict) or set(nimi_state) != {"output_items", "tools"}:
            raise ValueError("Invalid Nimi replay state")
        encoded = json.dumps(nimi_state, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(encoded) > 2 * 1024 * 1024:
            raise ValueError("Nimi replay state exceeds the storage limit")
        if not isinstance(nimi_state["output_items"], list) or not isinstance(
            nimi_state["tools"], list
        ):
            raise ValueError("Invalid Nimi replay collections")
        for item in nimi_state["output_items"]:
            if not isinstance(item, dict) or item.get("type") not in {
                "text",
                "tool-call",
                "reasoning-continuity",
            }:
                raise ValueError("Invalid Nimi output item")
            if item["type"] == "reasoning-continuity":
                payload = item.get("carrier", {}).get("payload")
                if (
                    not isinstance(payload, list)
                    or not 1 <= len(payload) <= 65536
                    or any(type(byte) is not int or not 0 <= byte <= 255 for byte in payload)
                ):
                    raise ValueError("Invalid Nimi continuity bytes")
        normalized["nimi_state"] = json.loads(encoded)
    reasoning_content = value.get("reasoning_content")
    if (
        isinstance(reasoning_content, str)
        and reasoning_content
        and len(reasoning_content) <= MAX_REASONING_CONTENT_CHARS
    ):
        normalized["reasoning_content"] = reasoning_content

    output_items = _normalized_output_items(value.get("responses_output_items"))
    if output_items:
        normalized["responses_output_items"] = output_items

    thinking_blocks = _normalized_thinking_blocks(value.get("thinking_blocks"))
    if thinking_blocks:
        normalized["thinking_blocks"] = thinking_blocks

    return normalized or None


def redact_private_message_metadata(messages: list[dict[str, Any]]) -> None:
    """Remove provider-only replay state before messages cross a public boundary."""
    for message in messages:
        metadata = message.get("metadata")
        if not isinstance(metadata, dict):
            continue
        for key in _PRIVATE_MESSAGE_METADATA_KEYS:
            metadata.pop(key, None)
