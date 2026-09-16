"""Factory for services-layer provider runtime objects."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
import contextlib
import hashlib
import json
import threading
from typing import Any

from deeptutor.services.llm.config import LLMConfig, get_llm_config
from deeptutor.services.llm.provider_core.base import GenerationSettings, LLMProvider

_PROVIDER_POOL_MAXSIZE = 2
_provider_pool: "OrderedDict[tuple[Any, ...], LLMProvider]" = OrderedDict()
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
    )


def _build_runtime_provider(llm_config: LLMConfig, *, configure_env: bool = True) -> LLMProvider:
    """Bind both service consumers and isolated steps to the supervised Host."""
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
    """
    llm_config = config or get_llm_config()
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return _build_runtime_provider(llm_config)

    key = _provider_cache_key(llm_config, loop)
    with _provider_pool_lock:
        cached = _provider_pool.get(key)
        if cached is not None:
            _provider_pool.move_to_end(key)
            return cached

        provider = _build_runtime_provider(llm_config)
        _provider_pool[key] = provider
        _provider_pool.move_to_end(key)
        while len(_provider_pool) > _PROVIDER_POOL_MAXSIZE:
            _, evicted = _provider_pool.popitem(last=False)
            _schedule_close(evicted, loop)
        return provider


async def close_runtime_provider_pool() -> None:
    """Close every pooled SDK client during shutdown or config reload."""
    with _provider_pool_lock:
        providers = list(_provider_pool.values())
        _provider_pool.clear()
    if providers:
        await asyncio.gather(*(provider.aclose() for provider in providers), return_exceptions=True)


def reset_runtime_provider_pool() -> None:
    """Clear the pool from synchronous cache-invalidation call sites."""
    with _provider_pool_lock:
        providers = list(_provider_pool.values())
        _provider_pool.clear()
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
    "build_isolated_provider",
    "close_runtime_provider_pool",
    "get_runtime_provider",
    "reset_runtime_provider_pool",
    "runtime_provider_pool_size",
]
