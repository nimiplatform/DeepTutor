"""Voice-over for video lessons: speak each scene's narration and time its captions.

Speech comes from the text-to-speech provider chosen in Settings when it is not Edge
(any provider ``synthesize_speech`` supports, e.g. OpenAI, a local OpenAI-compatible
Kokoro or Piper server, MiniMax), and otherwise from edge-tts (the free read-aloud
voices behind Microsoft Edge; no API key). When both fail, a scene keeps its captions,
timed from an estimated speaking rate, and plays silently.
"""

from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
import importlib.util
import json
import logging
import math
import re
import shutil

logger = logging.getLogger(__name__)

FPS = 30
VOICES = {"zh": "zh-CN-XiaoxiaoNeural", "en": "en-US-AvaNeural"}
SPEAK_TIMEOUT_S = 60
_CHARS_PER_SECOND = {"zh": 4.2, "en": 15.0}
_MP3_BYTES_PER_SECOND = 48_000 / 8  # edge-tts streams 24 kHz, 48 kbit/s mono mp3
_TICKS_PER_SECOND = 10_000_000  # edge-tts boundary offsets are in 100 ns units
_PARALLEL = 4
_PCM_RATE = 24_000
_PCM_BYTES_PER_SECOND = _PCM_RATE * 2  # 16-bit mono
_SENTENCE_GAP = bytes(int(_PCM_BYTES_PER_SECOND * 0.15) // 2 * 2)  # 0.15 s of silence
_SENTENCE_END = re.compile(r"(?<=[。！？；!?])|(?<=[.;])\s+")


@dataclass
class NarrationLine:
    id: str
    text: str


@dataclass
class Clip:
    text: str
    frames: int
    captions: list[tuple[int, str]]
    audio: bytes | None = None


def _lang(language: str) -> str:
    return "zh" if language.startswith("zh") else "en"


def estimate(text: str, language: str) -> Clip:
    """Silent clip: captions spaced by an average speaking rate."""
    rate = _CHARS_PER_SECOND[_lang(language)]
    at, captions = 0.0, []
    for sentence in (s.strip() for s in _SENTENCE_END.split(text)):
        if sentence:
            captions.append((round(at * FPS), sentence))
            at += len(sentence) / rate
    return Clip(text, max(1, math.ceil(at * FPS)), captions or [(0, text)])


async def speak(text: str, voice: str) -> Clip:
    raise RuntimeError(f"Configure speech models in Nimi App AIConfig (requested voice {voice}).")


def _configured_voice(language: str) -> str | None:
    _ = language
    try:
        from deeptutor.services.settings.interface_settings import get_ui_settings

        voice = str(get_ui_settings().get("nimi_speech_voice") or "").strip()
        return voice or None
    except Exception:
        return None


async def _nimi_tts_ready() -> bool:
    if not shutil.which("ffmpeg"):
        return False
    try:
        from deeptutor.nimi.media import ready_capabilities

        return "audio.synthesize" in await ready_capabilities()
    except Exception:
        return False


async def _ffmpeg(args: list[str], data: bytes) -> bytes:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-v",
        "error",
        *args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )  # nosec B603 - fixed argv
    try:
        out, err = await asyncio.wait_for(proc.communicate(data), timeout=60)
    except (TimeoutError, asyncio.CancelledError):
        if proc.returncode is None:
            proc.kill()
        await proc.wait()
        raise
    if proc.returncode != 0 or not out:
        raise RuntimeError(f"ffmpeg failed: {err.decode(errors='ignore')[:200]}")
    return out


async def speak_with_settings(text: str, *, voice: str | None = None) -> Clip:
    """Speak ``text`` with the Nimi TTS selection, one request per sentence."""
    from deeptutor.services.voice import synthesize_speech
    from deeptutor.services.voice.audio import _parse_pcm_content_type

    pcm = bytearray()
    captions: list[tuple[int, str]] = []
    for sentence in (s.strip() for s in _SENTENCE_END.split(text)):
        if not sentence:
            continue
        audio, content_type = await synthesize_speech(
            sentence, voice=voice, strip_markdown=False
        )
        pcm_format = _parse_pcm_content_type(content_type)
        input_args = []
        if pcm_format is not None:
            rate, channels = pcm_format
            input_args = ["-f", "s16le", "-ar", str(rate), "-ac", str(channels)]
        decoded = await _ffmpeg(
            [
                *input_args,
                "-i",
                "pipe:0",
                "-f",
                "s16le",
                "-ar",
                str(_PCM_RATE),
                "-ac",
                "1",
                "pipe:1",
            ],
            audio,
        )
        captions.append((round(len(pcm) / _PCM_BYTES_PER_SECOND * FPS), sentence))
        pcm += decoded + _SENTENCE_GAP
    if not captions:
        raise RuntimeError("the TTS provider returned no audio")
    mp3 = await _ffmpeg(
        [
            "-f",
            "s16le",
            "-ar",
            str(_PCM_RATE),
            "-ac",
            "1",
            "-i",
            "pipe:0",
            "-b:a",
            "64k",
            "-f",
            "mp3",
            "pipe:1",
        ],
        bytes(pcm),
    )
    return Clip(text, math.ceil(len(pcm) / _PCM_BYTES_PER_SECOND * FPS), captions, mp3)


async def narrate(
    lines: list[NarrationLine], language: str, cache: dict[str, Clip] | None = None
) -> dict[str, Clip]:
    """Record every line through Nimi TTS when ready; ``cache`` keeps clips across retries."""
    cache = {} if cache is None else cache
    voice = _configured_voice(language)
    tts_ready = await _nimi_tts_ready()
    gate = asyncio.Semaphore(_PARALLEL)

    async def one(text: str) -> Clip:
        if text not in cache:
            clip = None
            if tts_ready:
                async with gate:
                    try:
                        clip = await asyncio.wait_for(
                            speak_with_settings(text, voice=voice), SPEAK_TIMEOUT_S * 2
                        )
                    except Exception as exc:  # best effort; captions remain
                        logger.warning("video lesson narration via Nimi failed: %s", exc)
            cache[text] = clip or estimate(text, language)
        return cache[text]

    clips = await asyncio.gather(*(one(line.text) for line in lines))
    return {line.id: clip for line, clip in zip(lines, clips)}


def voice_module(clips: dict[str, Clip]) -> str:
    """The ``voice.ts`` the kit imports: text, length, captions and inline audio per scene."""
    data = {}
    for key, clip in clips.items():
        entry: dict = {
            "text": clip.text,
            "frames": clip.frames,
            "captions": [{"at": at, "text": text} for at, text in clip.captions],
        }
        if clip.audio:
            entry["src"] = "data:audio/mpeg;base64," + base64.b64encode(clip.audio).decode()
        data[key] = entry
    return "export const VOICE = " + json.dumps(data, ensure_ascii=False) + ";\n"


__all__ = [
    "Clip",
    "NarrationLine",
    "VOICES",
    "estimate",
    "narrate",
    "speak",
    "speak_with_settings",
    "voice_module",
]
