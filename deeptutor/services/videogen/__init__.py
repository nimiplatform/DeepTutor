"""App video generation through the verified Nimi Host."""
from __future__ import annotations
from typing import Any
from deeptutor.services.generation_http import GenerationProviderError
from deeptutor.services.videogen.base import ProgressFn
from deeptutor.services.videogen.config import VideogenConfig

async def generate_video(prompt: str, *, catalog: dict[str, Any] | None = None,
                         aspect_ratio: str | None = None, duration: str | None = None,
                         resolution: str | None = None, progress: ProgressFn | None = None,
                         action=None) -> tuple[bytes, str]:
    from deeptutor.nimi.media import MediaError, job_media
    from deeptutor.services.llm.exceptions import LLMProviderError
    if catalog is not None:
        raise ValueError("Configure video models in Nimi models, not the App provider catalog.")
    parameters = {"prompt": prompt, "ratio": aspect_ratio or "", "resolution": resolution or ""}
    if duration is not None and str(duration).strip():
        parameters["durationSec"] = float(duration)
    try:
        media = await job_media("video-generate", parameters, "video/", action=action, progress=progress)
        if len(media) != 1:
            raise MediaError("Nimi returned an unexpected number of videos.")
        return media[0]
    except (MediaError, LLMProviderError) as exc:
        raise GenerationProviderError(str(exc)) from exc

async def probe_video(prompt: str, *, catalog: dict[str, Any] | None = None) -> str:
    raise ValueError("Choose a video model in Nimi models. Provider connection tests belong to Nimi.")

__all__ = ["GenerationProviderError", "VideogenConfig", "generate_video", "probe_video"]
