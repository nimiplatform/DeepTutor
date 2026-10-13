"""Media business operations; Nimi owns model configuration and Job execution."""

from __future__ import annotations

import asyncio
import base64
from contextlib import suppress
from dataclasses import dataclass
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5

from .transport import get_transport

CHUNK_BYTES = 512 * 1024
TERMINAL = {"completed", "failed", "canceled", "timeout"}
CAPABILITIES = {"tts": "audio.synthesize", "stt": "audio.transcribe",
                "imagegen": "image.generate", "videogen": "video.generate"}


class MediaError(RuntimeError):
    pass


@dataclass
class MediaAction:
    session_id: str
    request_id: str
    workspace_id: str = ""
    output_directory: str = ""

    async def load(self) -> dict[str, Any] | None:
        from deeptutor.services.session import get_session_store

        session = await get_session_store().get_session(self.session_id)
        if session is None:
            raise MediaError("The conversation for this media task no longer exists.")
        return (session.get("preferences") or {}).get("nimi_media_" + self.request_id)

    async def save(self, value: dict[str, Any]) -> None:
        from deeptutor.services.session import get_session_store

        if not await get_session_store().update_session_preferences(
            self.session_id, {"nimi_media_" + self.request_id: value}
        ):
            raise MediaError("Could not save this media task in its conversation.")


def action_for_tool(kwargs: dict[str, Any], kind: str) -> MediaAction | None:
    session_id = str(kwargs.get("_nimi_session_id") or "")
    call_id = str(kwargs.get("_nimi_call_id") or "")
    turn_id = str(kwargs.get("_nimi_turn_id") or "")
    if not session_id or not call_id or not turn_id:
        return None
    if not kwargs.get("_workspace_id") or not str(kwargs.get("_nimi_logical_output") or "").startswith("outputs/"):
        raise MediaError("This media action has no learning workspace. Reopen the conversation before generating.")
    request_id = str(uuid5(NAMESPACE_URL, f"deeptutor:{session_id}:{turn_id}:{call_id}:{kind}"))
    return MediaAction(session_id, request_id, str(kwargs.get("_workspace_id") or ""),
                       str(kwargs.get("_nimi_logical_output") or "") + "/media/" + request_id)


async def ready_capabilities() -> set[str]:
    value = await get_transport().request("media.config", {})
    return {row["capabilityContract"] for row in value["selections"] if row["state"] == "ready"}


async def read_artifact(job_id: str, artifact: dict[str, Any]) -> tuple[bytes, str]:
    expected = int(artifact["sizeBytes"])
    if expected <= 0:
        raise MediaError("Nimi returned an empty media artifact.")
    output = bytearray()
    while len(output) < expected:
        chunk = await get_transport().request("media.artifact", {
            "jobId": job_id, "artifactId": artifact["artifactId"], "offset": len(output),
        })
        data = base64.b64decode(chunk["bytes"], validate=True)
        if (chunk["offset"] != len(output) or chunk["sizeBytes"] != expected
                or chunk["mimeType"] != artifact["mimeType"] or not data
                or len(data) > CHUNK_BYTES or len(output) + len(data) > expected):
            raise MediaError("Nimi media transfer did not match the completed artifact.")
        output.extend(data)
    return bytes(output), artifact["mimeType"]


async def run_job(kind: str, parameters: dict[str, Any], *, audio: bytes | None = None,
                  action: MediaAction | None = None, progress=None) -> dict[str, Any]:
    host = get_transport()
    submission_id = action.request_id if action else str(uuid4())
    previous = await action.load() if action else None
    record = previous or {"requestId": submission_id, "type": kind, "parameters": parameters, "status": "submitting",
                          **({"workspaceId": action.workspace_id, "outputDirectory": action.output_directory} if action else {})}
    if previous and (previous["type"] != kind or previous["parameters"] != parameters):
        raise MediaError("This action already belongs to a different media request.")
    job = None
    upload_id = None
    if previous:
        # Once an action was durably started, a missing/expired Job is an error.
        # Never turn lookup failure into a fresh, potentially billable submit.
        job = await host.request("media.lookup", {"requestId": submission_id})
    else:
        if action:
            await action.save(record)
        try:
            if audio is not None:
                upload_id = (await host.request("media.audio.begin", {"sizeBytes": len(audio)}))["id"]
                for offset in range(0, len(audio), CHUNK_BYTES):
                    await host.request("media.audio.chunk", {"id": upload_id, "offset": offset,
                        "bytes": base64.b64encode(audio[offset:offset + CHUNK_BYTES]).decode("ascii")})
            job = await host.request("media.submit", {"requestId": submission_id, "type": kind,
                "parameters": parameters, **({"audioId": upload_id} if upload_id else {})})
        except asyncio.CancelledError:
            # Submit may already have reached Runtime. Look up this exact action
            # instead of assuming a canceled HTTP observer means no Job exists.
            with suppress(Exception):
                admitted = await asyncio.shield(host.request("media.lookup", {"requestId": submission_id}))
                if admitted["status"] not in TERMINAL:
                    await asyncio.shield(host.request("media.cancel", {"jobId": admitted["jobId"]}))
            raise
        finally:
            if upload_id:
                with suppress(Exception):
                    await host.request("media.audio.release", {"id": upload_id})
    try:
        while True:
            if job["scenarioType"] != kind:
                raise MediaError("Nimi returned a different media task.")
            updated = {**record, "jobId": job["jobId"], "status": job["status"],
                      "reasonCode": job.get("reasonCode", ""), "reasonDetail": job.get("reasonDetail", "")}
            if action and updated != record:
                await action.save(updated)
            record = updated
            if progress:
                await progress(f"Nimi: {job['status']} ({job.get('progressPercent', 0)}%)")
            if job["status"] in TERMINAL:
                if job["status"] != "completed":
                    raise MediaError(job.get("reasonDetail") or job.get("reasonCode") or f"Media task {job['status']}")
                return job
            await asyncio.sleep(1)
            job = await host.request("media.get", {"jobId": job["jobId"]})
    except asyncio.CancelledError:
        if job and job["status"] not in TERMINAL:
            with suppress(Exception):
                await asyncio.shield(host.request("media.cancel", {"jobId": job["jobId"]}))
        raise


async def job_media(kind: str, parameters: dict[str, Any], mime_prefix: str, *, action=None, progress=None):
    job = await run_job(kind, parameters, action=action, progress=progress)
    artifacts = job.get("artifacts") or []
    if not artifacts or any(not row["mimeType"].startswith(mime_prefix) for row in artifacts):
        raise MediaError("Nimi completed the task without the expected media output.")
    return [await read_artifact(job["jobId"], row) for row in artifacts]


async def save_generated_media(action: MediaAction, media: list[tuple[bytes, str]]):
    """Use the existing workspace and session state for durable App results."""
    from deeptutor.services.workspace import get_content_workspace_service
    from deeptutor.tools.media_gen_tool import _EXT_BY_CONTENT_TYPE, _write_media, _slug

    record = await action.load()
    if not record:
        raise MediaError("The media action is missing from its conversation.")
    if any(mime.split(";", 1)[0] not in _EXT_BY_CONTENT_TYPE for _, mime in media):
        raise MediaError("The completed media format cannot be saved by this workspace.")
    workspace = get_content_workspace_service()
    binding = workspace.binding_by_id(record["workspaceId"])
    target = workspace.resolve(binding, record["outputDirectory"], write=True)
    target.mkdir(parents=True, exist_ok=True)
    video = record["type"] == "video-generate"
    artifacts = _write_media(target, media, stem=_slug(record["parameters"]["prompt"], "video" if video else "image"),
                             default_ext="mp4" if video else "png", workspace_id=binding.workspace_id)
    published = workspace.publish(binding, [{"path": row.relative_path} for row in artifacts])
    await action.save({**record, "status": "saved", "files": [row.to_dict() for row in published]})
    return artifacts


async def recover_action(session_id: str, request_id: str, *, cancel: bool = False):
    action = MediaAction(session_id, request_id)
    record = await action.load()
    if not record:
        raise MediaError("This conversation has no matching media action.")
    if record["status"] == "saved":
        return record
    host = get_transport()
    job = await host.request("media.lookup", {"requestId": request_id})
    if job["scenarioType"] != record["type"]:
        raise MediaError("Nimi returned a different media action.")
    if cancel and job["status"] not in TERMINAL:
        job = await host.request("media.cancel", {"jobId": job["jobId"]})
    record = {**record, "jobId": job["jobId"], "status": job["status"],
              "reasonDetail": job.get("reasonDetail") or job.get("reasonCode") or ""}
    await action.save(record)
    if job["status"] == "completed":
        prefix = "video/" if record["type"] == "video-generate" else "image/"
        if not job["artifacts"] or any(not row["mimeType"].startswith(prefix) for row in job["artifacts"]):
            raise MediaError("The completed task has no expected media artifact.")
        payload = [await read_artifact(job["jobId"], row) for row in job["artifacts"]]
        await save_generated_media(action, payload)
    return await action.load()
