"""Speech synthesis/transcription through the same Nimi Host as learning."""
from __future__ import annotations
from typing import Any
from deeptutor.services.voice.base import TranscriptCue, VoiceProviderError, strip_markdown_for_speech
from deeptutor.services.voice.config import STTConfig, TTSConfig

def _no_catalog(catalog):
    if catalog is not None:
        raise ValueError("Configure speech models in Nimi models, not the App provider catalog.")

async def synthesize_speech(text: str, *, catalog: dict[str, Any] | None = None,
                            voice: str | None = None, response_format: str | None = None,
                            strip_markdown: bool = True) -> tuple[bytes, str]:
    from deeptutor.nimi.media import MediaError, job_media
    from deeptutor.services.llm.exceptions import LLMProviderError
    _no_catalog(catalog)
    prepared = strip_markdown_for_speech(text) if strip_markdown else text.strip()
    if not prepared:
        raise VoiceProviderError("Nothing to speak after cleaning the text.")
    try:
        media = await job_media("speech-synthesize", {"text": prepared, "voice": voice or "",
            "format": response_format or ""}, "audio/")
        if len(media) != 1:
            raise MediaError("Nimi returned an unexpected number of speech artifacts.")
        return media[0]
    except (MediaError, LLMProviderError) as exc:
        raise VoiceProviderError(str(exc)) from exc

async def _transcript(audio, content_type, language, *, timestamps):
    from deeptutor.nimi.media import MediaError, run_job
    from deeptutor.services.llm.exceptions import LLMProviderError
    try:
        job = await run_job("speech-transcribe", {"mimeType": content_type.split(";",1)[0],
            "language": language or "", "timestamps": timestamps}, audio=audio)
        transcript = job.get("transcription")
        if not isinstance(transcript, dict):
            raise MediaError("Nimi completed transcription without its typed transcript.")
        return transcript
    except (MediaError, LLMProviderError) as exc:
        raise VoiceProviderError(str(exc)) from exc

async def transcribe_audio(audio: bytes, *, catalog: dict[str, Any] | None = None,
                           filename: str = "audio.wav", content_type: str = "audio/wav",
                           language: str | None = None) -> str:
    _no_catalog(catalog)
    result = await _transcript(audio, content_type, language, timestamps=False)
    return result["text"]

async def transcribe_audio_cues(audio: bytes, *, catalog: dict[str, Any] | None = None,
                                filename: str = "audio.wav", content_type: str = "audio/wav",
                                language: str | None = None) -> list[TranscriptCue]:
    _no_catalog(catalog)
    result = await _transcript(audio, content_type, language, timestamps=True)
    if result["status"] == "no-speech":
        return []
    if not result["words"]:
        raise VoiceProviderError("The selected transcription model did not return the requested word timings.")
    return [TranscriptCue(row["startSeconds"], row["endSeconds"], row["text"]) for row in result["words"]]

__all__ = ["TranscriptCue", "VoiceProviderError", "TTSConfig", "STTConfig", "synthesize_speech",
           "transcribe_audio", "transcribe_audio_cues", "strip_markdown_for_speech"]
