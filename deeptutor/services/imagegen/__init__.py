"""App image generation through the verified Nimi Host."""
from __future__ import annotations
from typing import Any
from deeptutor.services.generation_http import GenerationProviderError
from deeptutor.services.imagegen.config import ImagegenConfig

async def generate_image(prompt: str, *, catalog: dict[str, Any] | None = None,
                         size: str | None = None, quality: str | None = None,
                         style: str | None = None, n: int = 1, action=None) -> list[tuple[bytes, str]]:
    from deeptutor.nimi.media import MediaError, job_media
    from deeptutor.services.llm.exceptions import LLMProviderError
    if catalog is not None:
        raise ValueError("Configure image models in Nimi models, not the App provider catalog.")
    try:
        return await job_media("image-generate", {"prompt": prompt, "size": size or "",
            "quality": quality or "", "style": style or "", "n": n}, "image/", action=action)
    except (MediaError, LLMProviderError) as exc:
        raise GenerationProviderError(str(exc)) from exc

__all__ = ["GenerationProviderError", "ImagegenConfig", "generate_image"]
