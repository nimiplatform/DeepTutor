"""Structured retries preserve the configured Nimi model settings.

Only a successful but unusable payload can reach the bounded second call.
Callers retain their own definition of a usable business result.
"""

from __future__ import annotations

from typing import Any

import pytest

from deeptutor.services.llm.structured_retry import (
    json_payload_is_usable,
    json_with_reasoning_retry,
    payload_with_reasoning_retry,
)


def _recorder(*responses: str):
    """A ``run`` that returns the given bodies in order, logging the effort."""
    efforts: list[str | None] = []
    remaining = list(responses)

    async def run(reasoning_effort: str | None) -> str:
        efforts.append(reasoning_effort)
        return remaining.pop(0) if remaining else ""

    return run, efforts


@pytest.mark.asyncio
async def test_a_usable_first_answer_is_not_paid_for_twice() -> None:
    run, efforts = _recorder('{"spine": [1]}')
    result = await json_with_reasoning_retry(run, expected_key="spine")
    assert result == {"spine": [1]}
    assert efforts == [None], "a good answer must not trigger a second call"


@pytest.mark.asyncio
async def test_unusable_output_is_retried_with_unchanged_model_settings() -> None:
    run, efforts = _recorder("", '{"spine": [1]}')
    result = await json_with_reasoning_retry(run, expected_key="spine")
    assert result == {"spine": [1]}
    assert efforts == [None, None]


@pytest.mark.asyncio
async def test_the_expected_key_is_what_counts_as_answered() -> None:
    """A well-formed object missing the key is still a starved answer.

    This is the #1316 shape exactly: valid JSON, no content, and a caller that
    would have degraded silently.
    """
    run, efforts = _recorder('{"notes": "thinking..."}', '{"spine": [1]}')
    result = await json_with_reasoning_retry(run, expected_key="spine")
    assert result == {"spine": [1]}
    assert efforts == [None, None]


@pytest.mark.asyncio
async def test_two_starved_attempts_return_the_callers_empty_fallback() -> None:
    run, _ = _recorder("", "")
    assert await json_with_reasoning_retry(run, expected_key="spine") == {}


@pytest.mark.asyncio
async def test_the_object_shaped_helper_never_hands_back_a_list() -> None:
    """Callers of the object form index the result, so it must be a dict."""
    run, _ = _recorder("[1, 2, 3]", "[4]")
    assert await json_with_reasoning_retry(run, expected_key=None) == {}


@pytest.mark.asyncio
async def test_a_caller_that_accepts_an_array_keeps_its_array() -> None:
    """The generic form must not impose the object shape on everyone.

    Research's decompose accepts a bare array of sub-topics. Judging that
    "unusable" would retry a perfectly good answer and then discard it — a
    regression the object-shaped helper would have caused if it were the only
    entry point.
    """

    def accepts_anything_non_empty(payload: Any) -> bool:
        return bool(payload)

    run, efforts = _recorder("[1, 2, 3]")
    result = await payload_with_reasoning_retry(run, is_usable=accepts_anything_non_empty)
    assert result == [1, 2, 3]
    assert efforts == [None]


@pytest.mark.asyncio
async def test_nothing_usable_and_nothing_non_empty_is_none() -> None:
    run, _ = _recorder("", "")
    assert await payload_with_reasoning_retry(run, is_usable=bool) is None


@pytest.mark.parametrize(
    ("payload", "expected_key", "usable"),
    [
        ({"spine": [1]}, "spine", True),
        ({"spine": []}, "spine", False),
        ({}, None, False),
        ({"anything": 1}, None, True),
        ([1], None, False),
        ("not json", None, False),
    ],
)
def test_object_usability_rule(payload: Any, expected_key: str | None, usable: bool) -> None:
    assert json_payload_is_usable(payload, expected_key) is usable
