from __future__ import annotations

import pytest

from deeptutor.book.blocks import text as text_block
from deeptutor.book.blocks.base import BlockContext
from deeptutor.book.models import Block, BlockStatus, BlockType, Chapter, Page


def _text_context() -> BlockContext:
    chapter = Chapter(id="ch-isolation", title="Mechanics", summary="Stress and strain")
    block = Block(type=BlockType.TEXT, params={"role": "explanation"})
    return BlockContext(
        book_id="book-isolation",
        chapter=chapter,
        page=Page(id="page-isolation", book_id="book-isolation", chapter_id=chapter.id),
        block=block,
        rag_enabled=False,
    )


@pytest.mark.asyncio
async def test_text_block_persists_only_visible_reader_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    async def fake_llm_text(**kwargs: object) -> str:
        calls.append(kwargs)
        return "Polished reader paragraph."

    monkeypatch.setattr(text_block, "llm_text", fake_llm_text)
    ctx = _text_context()

    result = await text_block.TextGenerator().generate(ctx)

    assert result.status == BlockStatus.READY
    assert result.payload["body"] == "Polished reader paragraph."
    assert calls[0].get("reasoning_effort") is None


@pytest.mark.asyncio
async def test_text_block_does_not_mark_reasoning_only_response_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_llm_text(**_kwargs: object) -> str:
        # Provider separation turns a reasoning-only response into empty
        # visible content; the block must not persist an empty READY payload.
        return ""

    monkeypatch.setattr(text_block, "llm_text", fake_llm_text)
    ctx = _text_context()

    result = await text_block.TextGenerator().generate(ctx)

    assert result.status == BlockStatus.ERROR
    assert result.payload == {}
    assert "no visible text" in result.error
    assert result.metadata["failure"]["retryable"] is True


@pytest.mark.asyncio
async def test_block_retains_public_failure_and_does_not_guess_retryability(monkeypatch):
    from deeptutor.nimi.transport import NimiRequestError

    async def fail(**_kwargs):
        raise NimiRequestError(
            {"message": "Rejected", "reasonCode": "AI_TOOL_CALL_INVALID", "traceId": "trace-test"}
        )

    monkeypatch.setattr(text_block, "llm_text", fail)
    result = await text_block.TextGenerator().generate(_text_context())
    assert result.status == BlockStatus.ERROR
    assert result.metadata["failure"]["retryable"] is False
    assert result.metadata["failure"]["reason_code"] == "AI_TOOL_CALL_INVALID"
    assert result.metadata["failure"]["trace_id"] == "trace-test"
