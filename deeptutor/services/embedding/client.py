"""Nimi-backed embedding consumption; indexes remain owned by DeepTutor."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from deeptutor.nimi.transport import get_transport

from .config import EmbeddingConfig, get_embedding_config
from .validation import validate_embedding_batch


def embedding_batches(texts: list[str]) -> list[list[str]]:
    batches: list[list[str]] = []
    batch: list[str] = []
    size = 0
    for text in texts:
        item_size = len(text.encode("utf-8", "strict"))
        if item_size > 32 * 1024:
            raise ValueError(
                "A text chunk exceeds Nimi's 32 KiB embedding input limit; reduce the chunk size."
            )
        if not text.strip():
            raise ValueError("Embedding inputs must not be empty.")
        if batch and (len(batch) == 16 or size + item_size > 64 * 1024):
            batches.append(batch)
            batch, size = [], 0
        batch.append(text)
        size += item_size
    if batch:
        batches.append(batch)
    return batches


class EmbeddingClient:
    def __init__(self, config: Optional[EmbeddingConfig] = None):
        self.config = config or get_embedding_config()
        self.logger = logging.getLogger(__name__)
        if self.config.binding != "nimi":
            raise ValueError("Configure embeddings through Nimi App AIConfig.")

    async def probe_space(self) -> tuple[str, int]:
        result = await get_transport().request(
            "embedding.batch", {"inputs": ["DeepTutor embedding space check."]}
        )
        vectors = validate_embedding_batch(
            result["vectors"], expected_count=1, binding="nimi", model="text.embed"
        )
        return result["spaceId"], len(vectors[0])

    async def embed(self, texts, progress_callback=None, *, input_type=None):
        if input_type not in {None, "search_query", "search_document"}:
            raise ValueError("Unsupported embedding retrieval role.")
        # The selected public text.embed contract is symmetric. Asymmetric
        # role-specific backends require their own admitted platform contract.
        batches = embedding_batches(texts)
        vectors = []
        space_id = self.config.space_id
        dimension = self.config.dim or None
        for number, batch in enumerate(batches, 1):
            result = await get_transport().request("embedding.batch", {"inputs": batch})
            actual_space = result["spaceId"]
            if not isinstance(actual_space, str) or not actual_space:
                raise ValueError("Nimi did not return an embedding spaceId.")
            if space_id is not None and actual_space != space_id:
                raise ValueError(
                    "Embedding space changed during this operation. The existing index has been preserved; re-index using the current App model."
                )
            space_id = actual_space
            batch_vectors = validate_embedding_batch(
                result["vectors"], expected_count=len(batch), binding="nimi", model="text.embed"
            )
            current_dimension = len(batch_vectors[0])
            if dimension is not None and current_dimension != dimension:
                raise ValueError("Embedding dimension changed within one space.")
            dimension = current_dimension
            vectors.extend(batch_vectors)
            if progress_callback:
                progress_callback(number, len(batches))
        return vectors

    def supports_multimodal_contents(self):
        return False

    async def embed_contents(self, contents, **kwargs):
        raise ValueError(
            "Image embedding is not admitted by the selected Nimi text.embed contract. No image input has been dropped."
        )

    def embed_sync(self, texts):
        return asyncio.run(self.embed(texts))


_client: EmbeddingClient | None = None


def get_embedding_client(config: Optional[EmbeddingConfig] = None) -> EmbeddingClient:
    # A captured space belongs to one index operation, never a global mutable
    # client that concurrent KB requests could silently replace.
    return EmbeddingClient(config)


def reset_embedding_client() -> None:
    global _client
    _client = None
