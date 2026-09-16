"""One bounded retry for unusable structured output, preserving AIConfig.

The historical helper names remain the callers' internal seam. A retry does
not lower reasoning, switch models, or catch a failed model call. Only a
successful response with unusable structure is eligible for another attempt.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from deeptutor.utils.json_parser import parse_json_response


def json_payload_is_usable(payload: Any, expected_key: str | None) -> bool:
    """Whether a parsed payload is worth keeping without a retry."""
    if not isinstance(payload, dict) or not payload:
        return False
    if expected_key is None:
        return True
    return bool(payload.get(expected_key))


async def payload_with_reasoning_retry(
    run: Callable[[str | None], Awaitable[str]],
    *,
    is_usable: Callable[[Any], bool],
    logger_instance: Any = None,
) -> Any:
    """Run ``run`` for a parsed payload, retrying once with the same settings.

    ``run`` receives the ``reasoning_effort`` to use (``None`` on the first
    attempt = whatever the model is configured for) and returns the raw
    response text.

    ``is_usable`` decides what "the model answered" means for this call site,
    and it belongs to the caller: a step expecting an object keyed by
    ``sections`` and a step that also accepts a bare array cannot share one
    definition, and hard-coding either would make the other silently discard a
    good answer. Returns the first usable payload, else the first non-empty
    one, else ``None``.
    """
    first = parse_json_response(await run(None), logger_instance=logger_instance, fallback=None)
    if is_usable(first):
        return first

    retried = parse_json_response(
        await run(None),
        logger_instance=logger_instance,
        fallback=None,
    )
    if is_usable(retried):
        return retried

    for candidate in (first, retried):
        if candidate:
            return candidate
    return None


async def json_with_reasoning_retry(
    run: Callable[[str | None], Awaitable[str]],
    *,
    expected_key: str | None = None,
    logger_instance: Any = None,
) -> dict[str, Any]:
    """The object-shaped case of :func:`payload_with_reasoning_retry`.

    Guarantees a ``dict`` — callers index it directly — so a model that
    answered with a bare array is treated as not having answered. Returns
    ``{}`` when neither attempt produced an object, so callers keep their
    existing "empty means fall back" handling.
    """
    payload = await payload_with_reasoning_retry(
        run,
        is_usable=lambda value: json_payload_is_usable(value, expected_key),
        logger_instance=logger_instance,
    )
    return payload if isinstance(payload, dict) else {}


__all__ = [
    "json_payload_is_usable",
    "json_with_reasoning_retry",
    "payload_with_reasoning_retry",
]
