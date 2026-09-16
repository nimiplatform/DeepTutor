"""Normalized embedding configuration resolved from the model catalog."""

from __future__ import annotations

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


def get_embedding_config() -> EmbeddingConfig:
    """Execution selection belongs to the current App AIConfig."""
    return EmbeddingConfig(
        model="text.embed", api_key="", binding="nimi", provider_name="nimi", provider_mode="nimi"
    )
