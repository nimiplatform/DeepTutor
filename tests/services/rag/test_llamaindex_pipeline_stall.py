"""Regression tests for bounded LlamaIndex indexing (issue #946).

Indexing steps run in a sync executor thread. An embedding provider that
accepts a request but never completes it (e.g. a blackholed keep-alive
connection) can stall the executor future forever: HTTP timeouts only bound
a single attempt, and provider retries extend the wait far past any
reasonable request budget. These tests pin the stall guard that fails such
operations with a clear error instead of hanging indefinitely.
"""

from __future__ import annotations

import asyncio
import threading
import time
from types import SimpleNamespace
from typing import Any

import pytest


def _llamaindex_modules() -> tuple[Any, Any, Any]:
    """Import the pipeline modules lazily, matching sibling test files."""
    from deeptutor.services.rag.pipelines.llamaindex import pipeline as pipeline_module
    from deeptutor.services.rag.pipelines.llamaindex import storage as storage_module
    from deeptutor.services.rag.pipelines.llamaindex.pipeline import LlamaIndexPipeline

    return pipeline_module, storage_module, LlamaIndexPipeline


async def _async_noop(*args, **kwargs) -> None:
    """Async stand-in for connectivity checks that need no provider call."""


class _ProgressModel:
    def __init__(self):
        self.callback = None

    def set_progress_callback(self, callback):
        self.callback = callback


def _make_pipeline(tmp_path, monkeypatch: pytest.MonkeyPatch) -> Any:
    """Build a pipeline with provider calls neutralized for fast tests."""
    pipeline_module, _storage_module, LlamaIndexPipeline = _llamaindex_modules()
    monkeypatch.setattr(pipeline_module, "_INDEX_STALL_POLL_SECONDS", 0.05)
    monkeypatch.setattr(pipeline_module, "_INDEX_STALL_TIMEOUT_SECONDS", 0.3)
    monkeypatch.setattr(LlamaIndexPipeline, "_configure_settings", lambda self: None)
    monkeypatch.setattr(LlamaIndexPipeline, "_verify_embedding_connectivity", _async_noop)

    async def _prepare_embedding(self):
        return None, _ProgressModel()

    monkeypatch.setattr(LlamaIndexPipeline, "_prepare_embedding", _prepare_embedding)

    async def _fake_load(file_paths, **kwargs):
        del file_paths, kwargs
        return [SimpleNamespace(text="hello world")]

    monkeypatch.setattr(
        pipeline_module, "LlamaIndexDocumentLoader", lambda logger: SimpleNamespace(load=_fake_load)
    )
    return LlamaIndexPipeline(kb_base_dir=str(tmp_path), signature_provider=lambda: None)


@pytest.mark.asyncio
async def test_stall_guard_raises_when_no_progress_is_reported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An executor step that never reports progress must fail bounded."""
    pipeline_module, _, _ = _llamaindex_modules()
    monkeypatch.setattr(pipeline_module, "_INDEX_STALL_POLL_SECONDS", 0.05)

    def never_finishes():
        time.sleep(0.6)

    started = time.monotonic()
    with pytest.raises(pipeline_module.IndexingStallError, match="no progress"):
        await pipeline_module._run_with_stall_guard(
            never_finishes,
            embedding_model=_ProgressModel(),
            progress_callback=None,
            stall_timeout=0.2,
        )
    assert time.monotonic() - started < 10


@pytest.mark.asyncio
async def test_stall_guard_returns_when_progress_keeps_flowing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A slow-but-moving step must not be mistaken for a stall."""
    pipeline_module, _, _ = _llamaindex_modules()
    monkeypatch.setattr(pipeline_module, "_INDEX_STALL_POLL_SECONDS", 0.05)
    model = _ProgressModel()

    def slow_but_moving():
        end = time.monotonic() + 0.6
        while time.monotonic() < end:
            model.callback(1, 1)
            time.sleep(0.05)
        return "done"

    assert (
        await pipeline_module._run_with_stall_guard(
            slow_but_moving, embedding_model=model, progress_callback=None, stall_timeout=0.3
        )
        == "done"
    )
    assert model.callback is None


@pytest.mark.asyncio
async def test_stall_guard_keeps_concurrent_captured_models_independent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Finishing one operation must not clear another operation's heartbeat."""
    pipeline_module, _, _ = _llamaindex_modules()
    monkeypatch.setattr(pipeline_module, "_INDEX_STALL_POLL_SECONDS", 0.05)
    slow, fast = _ProgressModel(), _ProgressModel()
    events = {"slow": [], "fast": []}

    def moving(model, duration):
        end = time.monotonic() + duration
        while time.monotonic() < end:
            model.callback(1, 1)
            time.sleep(0.05)
        return "done"

    results = await asyncio.gather(
        *[
            pipeline_module._run_with_stall_guard(
                lambda model=model, duration=duration: moving(model, duration),
                embedding_model=model,
                progress_callback=lambda *event, name=name: events[name].append(event),
                stall_timeout=0.3,
            )
            for name, model, duration in [("slow", slow, 0.6), ("fast", fast, 0.1)]
        ]
    )
    assert results == ["done", "done"]
    assert len(events["slow"]) > len(events["fast"]) > 0
    assert slow.callback is None and fast.callback is None


@pytest.mark.asyncio
async def test_stall_guard_forwards_user_progress_callback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The user-facing progress callback must keep receiving batch events."""
    pipeline_module, _, _ = _llamaindex_modules()
    monkeypatch.setattr(pipeline_module, "_INDEX_STALL_POLL_SECONDS", 0.05)
    model = _ProgressModel()
    owner_thread = threading.get_ident()
    owner_loop = asyncio.get_running_loop()
    events: list[tuple[int, int]] = []

    def user_callback(batch_num, total_batches):
        assert threading.get_ident() == owner_thread
        assert asyncio.get_running_loop() is owner_loop
        events.append((batch_num, total_batches))

    def reports_once():
        model.callback(2, 10)
        return "ok"

    assert (
        await pipeline_module._run_with_stall_guard(
            reports_once, embedding_model=model, progress_callback=user_callback, stall_timeout=1.0
        )
        == "ok"
    )
    assert events == [(2, 10)]


@pytest.mark.asyncio
async def test_initialize_fails_bounded_when_indexing_stalls(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """initialize() must raise IndexingStallError instead of hanging forever."""
    pipeline_module, storage_module, _ = _llamaindex_modules()
    pipeline = _make_pipeline(tmp_path, monkeypatch)

    def _blocking_create_index(*args, **kwargs):
        del args, kwargs
        time.sleep(0.6)

    monkeypatch.setattr(storage_module, "create_index", _blocking_create_index)

    started = time.monotonic()
    with pytest.raises(pipeline_module.IndexingStallError, match="no progress"):
        await pipeline.initialize("kb", ["doc.pdf"])
    assert time.monotonic() - started < 10


@pytest.mark.asyncio
async def test_add_documents_fails_bounded_when_new_index_stalls(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """add_documents() new-index path must also fail bounded on a stall."""
    pipeline_module, storage_module, _ = _llamaindex_modules()
    pipeline = _make_pipeline(tmp_path, monkeypatch)

    def _blocking_create_index(*args, **kwargs):
        del args, kwargs
        time.sleep(0.6)

    monkeypatch.setattr(storage_module, "create_index", _blocking_create_index)

    started = time.monotonic()
    with pytest.raises(pipeline_module.IndexingStallError, match="no progress"):
        await pipeline.add_documents("kb", ["doc.pdf"])
    assert time.monotonic() - started < 10


@pytest.mark.asyncio
async def test_initialize_succeeds_when_indexing_completes(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The happy path must be unaffected by the stall guard."""
    _pipeline_module, storage_module, _ = _llamaindex_modules()
    pipeline = _make_pipeline(tmp_path, monkeypatch)
    events = []

    def create_index(*args, embedding_model, **kwargs):
        embedding_model.callback(1, 2)
        embedding_model.callback(2, 2)
        return 7

    monkeypatch.setattr(storage_module, "create_index", create_index)

    assert (
        await pipeline.initialize(
            "kb", ["doc.pdf"], progress_callback=lambda *event: events.append(event)
        )
        is True
    )
    assert events == [(1, 2), (2, 2)]


@pytest.mark.asyncio
async def test_guard_suppresses_captured_callbacks_after_a_stall(monkeypatch):
    pipeline_module, _, _ = _llamaindex_modules()
    monkeypatch.setattr(pipeline_module, "_INDEX_STALL_POLL_SECONDS", 0.02)
    model = _ProgressModel()
    captured = []
    events = []
    release = threading.Event()

    def blocked():
        captured.append(model.callback)
        release.wait(2)
        captured[0](1, 1)

    try:
        with pytest.raises(pipeline_module.IndexingStallError):
            await pipeline_module._run_with_stall_guard(
                blocked,
                embedding_model=model,
                progress_callback=lambda *event: events.append(event),
                stall_timeout=0.1,
            )
        assert model.callback is None
        captured[0](2, 2)
        await asyncio.sleep(0)
        assert events == []
    finally:
        release.set()
