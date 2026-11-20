"""Normalized embedding configuration resolved from the model catalog."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from dataclasses import dataclass


@dataclass
class EmbeddingConfig:
    """Embedding runtime configuration."""

    model: str
    api_key: str | list[str]
    base_url: str | None = None
    effective_url: str | None = None
    binding: str = "openai"
    provider_name: str = "openai"
    provider_mode: str = "standard"
    api_version: str | None = None
    extra_headers: dict[str, str] | None = None
    space_id: str | None = None
    dim: int = 0
    send_dimensions: bool | None = None
    request_timeout: int = 60
    batch_size: int = 10
    batch_delay: float = 0.0


_scoped_config: ContextVar[EmbeddingConfig | None] = ContextVar("embedding_config", default=None)


def scoped_embedding_config() -> EmbeddingConfig | None:
    return _scoped_config.get()


@contextmanager
def embedding_config_scope(config: EmbeddingConfig):
    """Bind one operation, including its worker threads, to a resolved model."""
    token = _scoped_config.set(config)
    try:
        yield
    finally:
        _scoped_config.reset(token)


def get_embedding_config(
    selection: dict | None = None, *, catalog: dict | None = None
) -> EmbeddingConfig:
    """Execution selection belongs to the current App AIConfig."""
    if selection is None and catalog is None and _scoped_config.get() is not None:
        return _scoped_config.get()
    if selection is not None:
        raise ValueError("Configure embeddings through Nimi App AIConfig.")
    return EmbeddingConfig(
        model="text.embed", api_key="", binding="nimi", provider_name="nimi", provider_mode="nimi"
    )
