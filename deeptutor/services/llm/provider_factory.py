"""Factory for services-layer provider runtime objects."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Iterator
import contextlib
from dataclasses import dataclass
import hashlib
import json
import os
import threading
from typing import Any

from deeptutor.services.llm.config import LLMConfig, get_llm_config
from deeptutor.services.llm.provider_core.base import GenerationSettings, LLMProvider

_PROVIDER_POOL_MAXSIZE = 2


@dataclass
class _ProviderEntry:
    provider: LLMProvider
    users: int = 0
    retired: bool = False


_provider_pool: "OrderedDict[tuple[Any, ...], _ProviderEntry]" = OrderedDict()
_provider_pool_lock = threading.RLock()


def _secret_fingerprint(value: str | list[str] | None) -> str:
    if not value:
        return ""
    serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:16]


def _provider_cache_key(config: LLMConfig, loop: asyncio.AbstractEventLoop) -> tuple[Any, ...]:
    headers = json.dumps(config.extra_headers or {}, sort_keys=True, separators=(",", ":"))
    return (
        loop,
        os.getenv("DEEPTUTOR_CHAT_ENGINE", "python"),
        config.provider_name or config.binding,
        config.provider_mode,
        config.model,
        _secret_fingerprint(config.api_key),
        config.effective_url or config.base_url or "",
        config.api_version or "",
        headers,
        config.wire_api,
        config.api_format,
        config.temperature,
        config.max_tokens,
        config.reasoning_effort,
        config.max_concurrency,
        config.requests_per_minute,
    )


def _build_runtime_provider(
    llm_config: LLMConfig,
    *,
    configure_env: bool = True,
    native_enabled: bool = True,
) -> LLMProvider:
    """Bind both service consumers and isolated steps to the supervised Host."""
    _ = (configure_env, native_enabled)
    from deeptutor.nimi.llm import NimiLLMProvider
    from deeptutor.services.llm.exceptions import LLMConfigError

    if llm_config.binding != "nimi" or llm_config.model != "text.generate":
        raise LLMConfigError("Configure AI through Nimi App AIConfig.")
    provider = NimiLLMProvider()
    provider.generation = GenerationSettings(
        temperature=llm_config.temperature,
        max_tokens=llm_config.max_tokens,
        reasoning_effort=llm_config.reasoning_effort,
    )
    return provider


def build_isolated_provider(config: LLMConfig) -> LLMProvider:
    """Build an unpooled provider without mutating process-global provider env."""
    return _build_runtime_provider(config, configure_env=False)


def _schedule_close(provider: LLMProvider, loop: asyncio.AbstractEventLoop) -> None:
    async def _close() -> None:
        with contextlib.suppress(Exception):
            await provider.aclose()

    loop.create_task(_close())


def get_runtime_provider(config: LLMConfig | None = None) -> LLMProvider:
    """Return a small event-loop-local pool entry for the supplied config.

    A provider owns an SDK HTTP connection pool. Recreating it for every token
    request steadily raises the process high-water mark and forfeits keep-alive.
    Calls made outside an event loop remain uncached for cross-loop safety.
    Request execution should use ``acquire_runtime_provider`` to keep the
    client alive across awaits, even when its cache entry is evicted.
    """
    llm_config = config or get_llm_config()
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return _build_runtime_provider(llm_config)

    with _provider_pool_lock:
        return _get_runtime_entry(llm_config, loop).provider


def _get_runtime_entry(config: LLMConfig, loop: asyncio.AbstractEventLoop) -> _ProviderEntry:
    """Look up an entry while holding ``_provider_pool_lock``."""
    key = _provider_cache_key(config, loop)
    cached = _provider_pool.get(key)
    if cached is not None:
        _provider_pool.move_to_end(key)
        return cached

    entry = _ProviderEntry(_build_runtime_provider(config))
    _provider_pool[key] = entry
    while len(_provider_pool) > _PROVIDER_POOL_MAXSIZE:
        _, evicted = _provider_pool.popitem(last=False)
        evicted.retired = True
        if not evicted.users:
            _schedule_close(evicted.provider, loop)
    return entry


@contextlib.contextmanager
def acquire_runtime_provider(config: LLMConfig | None = None) -> Iterator[LLMProvider]:
    """Lease a pooled client for the entire request, including retries.

    Retirement removes the cache entry immediately; the last request releases
    its client on success, error, or cancellation. Idle cached clients remain
    bounded, while active requests may temporarily retain retired clients.
    """
    loop = asyncio.get_running_loop()
    llm_config = config or get_llm_config()
    with _provider_pool_lock:
        entry = _get_runtime_entry(llm_config, loop)
        entry.users += 1
    try:
        yield entry.provider
    finally:
        with _provider_pool_lock:
            entry.users -= 1
            if entry.retired and not entry.users:
                _schedule_close(entry.provider, loop)


def _retire_runtime_provider_pool() -> list[LLMProvider]:
    """Remove all entries and return only clients safe to close immediately."""
    with _provider_pool_lock:
        entries = list(_provider_pool.values())
        _provider_pool.clear()
        for entry in entries:
            entry.retired = True
        return [entry.provider for entry in entries if not entry.users]


async def close_runtime_provider_pool() -> None:
    """Retire pooled clients; active requests close theirs on final release."""
    providers = _retire_runtime_provider_pool()
    if providers:
        await asyncio.gather(*(provider.aclose() for provider in providers), return_exceptions=True)


def reset_runtime_provider_pool() -> None:
    """Clear the pool from synchronous cache-invalidation call sites."""
    providers = _retire_runtime_provider_pool()
    if not providers:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        for provider in providers:
            with contextlib.suppress(Exception):
                asyncio.run(provider.aclose())
        return
    for provider in providers:
        _schedule_close(provider, loop)


def runtime_provider_pool_size() -> int:
    """Expose the bounded size for diagnostics and regression tests."""
    with _provider_pool_lock:
        return len(_provider_pool)


__all__ = [
    "acquire_runtime_provider",
    "build_isolated_provider",
    "close_runtime_provider_pool",
    "get_runtime_provider",
    "reset_runtime_provider_pool",
    "runtime_provider_pool_size",
]
