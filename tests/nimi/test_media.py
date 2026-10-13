import asyncio
import base64
import pytest

from deeptutor.nimi import media
from deeptutor.services.session.sqlite_store import SQLiteSessionStore


@pytest.mark.asyncio
async def test_action_survives_store_reopen_and_only_observes_its_original_job(tmp_path, monkeypatch):
    store = SQLiteSessionStore(tmp_path / "sessions.sqlite")
    await store.create_session("Media", "session")
    monkeypatch.setattr("deeptutor.services.session.get_session_store", lambda: store)
    class Host:
        calls = []
        async def request(self, operation, value):
            self.calls.append((operation,value))
            return {"jobId":"original", "scenarioType":"image-generate", "status":"completed", "artifacts":[]}
    host=Host();monkeypatch.setattr(media,"get_transport",lambda:host)
    action=media.MediaAction("session","stable_action")
    assert (await media.run_job("image-generate",{"prompt":"中文"},action=action))["jobId"] == "original"
    store=SQLiteSessionStore(tmp_path / "sessions.sqlite")
    assert (await media.run_job("image-generate",{"prompt":"中文"},action=action))["jobId"] == "original"
    assert [name for name,_ in host.calls] == ["media.submit","media.lookup"]
    with pytest.raises(media.MediaError,match="different"):
        await media.run_job("image-generate",{"prompt":"changed"},action=action)


@pytest.mark.asyncio
async def test_unknown_submit_is_persisted_and_never_automatically_resubmitted(tmp_path, monkeypatch):
    store=SQLiteSessionStore(tmp_path/"sessions.sqlite");await store.create_session("Media","session")
    monkeypatch.setattr("deeptutor.services.session.get_session_store",lambda:store)
    class Host:
        calls=[]
        async def request(self,operation,value):
            self.calls.append(operation)
            raise media.MediaError("connection lost; outcome unknown")
    host=Host();monkeypatch.setattr(media,"get_transport",lambda:host)
    action=media.MediaAction("session","uncertain")
    for _ in range(2):
        with pytest.raises(media.MediaError,match="unknown"):
            await media.run_job("video-generate",{"prompt":"A scene"},action=action)
    assert host.calls == ["media.submit","media.lookup"]
    assert (await action.load())["status"] == "submitting"


@pytest.mark.asyncio
async def test_explicit_cancel_cancels_admitted_job(monkeypatch):
    entered=asyncio.Event()
    class Host:
        calls=[]
        async def request(self,operation,value):
            self.calls.append(operation)
            if operation=="media.get":
                entered.set();await asyncio.Future()
            return {"jobId":"job","scenarioType":"video-generate","status":"running","artifacts":[]}
    host=Host();monkeypatch.setattr(media,"get_transport",lambda:host)
    task=asyncio.create_task(media.run_job("video-generate",{"prompt":"scene"}))
    await entered.wait();task.cancel()
    with pytest.raises(asyncio.CancelledError):await task
    assert host.calls[-1]=="media.cancel"


@pytest.mark.asyncio
async def test_large_artifact_and_wrong_chunk_length(monkeypatch):
    payload=bytes(range(256))*9000
    class Host:
        async def request(self,operation,value):
            assert operation=="media.artifact"
            offset=value["offset"]
            return {"bytes":base64.b64encode(payload[offset:offset+media.CHUNK_BYTES]).decode(),
                    "offset":offset,"sizeBytes":len(payload),"mimeType":"image/png"}
    monkeypatch.setattr(media,"get_transport",lambda:Host())
    data,mime=await media.read_artifact("job",{"artifactId":"id","sizeBytes":len(payload),"mimeType":"image/png"})
    assert data==payload and mime=="image/png"
    with pytest.raises(media.MediaError,match="match"):
        await media.read_artifact("job",{"artifactId":"id","sizeBytes":len(payload)+1,"mimeType":"image/png"})


@pytest.mark.asyncio
async def test_voice_facade_preserves_real_transcription_timings_and_no_speech(monkeypatch):
    from deeptutor.services import voice
    async def run(kind,parameters,**kwargs):
        assert parameters["timestamps"] is True
        assert kwargs["audio"]==b"input"
        return {"transcription":{"status":"transcribed","text":"你好","words":[{"text":"你好","startSeconds":1.2,"endSeconds":1.7}]}}
    monkeypatch.setattr(media,"run_job",run)
    cues=await voice.transcribe_audio_cues(b"input",content_type="audio/wav")
    assert [(c.text,c.start_seconds,c.end_seconds,c.timed) for c in cues]==[("你好",1.2,1.7,True)]
    with pytest.raises(ValueError,match="Nimi"):
        await voice.synthesize_speech("hello",catalog={"services":{}})


@pytest.mark.asyncio
async def test_parallel_media_actions_keep_both_conversation_records(tmp_path, monkeypatch):
    store=SQLiteSessionStore(tmp_path/"sessions.sqlite");await store.create_session("Media","session")
    monkeypatch.setattr("deeptutor.services.session.get_session_store",lambda:store)
    actions=[media.MediaAction("session",f"action_{i}") for i in range(8)]
    await asyncio.gather(*(action.save({"status":"running","requestId":action.request_id}) for action in actions))
    reopened=SQLiteSessionStore(tmp_path/"sessions.sqlite")
    preferences=(await reopened.get_session("session"))["preferences"]
    assert all(preferences["nimi_media_"+action.request_id]["status"]=="running" for action in actions)


@pytest.mark.asyncio
async def test_canceled_submit_looks_up_and_cancels_the_same_action(monkeypatch):
    entered=asyncio.Event()
    class Host:
        calls=[]
        async def request(self,operation,value):
            self.calls.append((operation,value))
            if operation=="media.submit":
                entered.set();await asyncio.Future()
            return {"jobId":"admitted","scenarioType":"video-generate","status":"running","artifacts":[]}
    host=Host();monkeypatch.setattr(media,"get_transport",lambda:host)
    task=asyncio.create_task(media.run_job("video-generate",{"prompt":"scene"}))
    await entered.wait();task.cancel()
    with pytest.raises(asyncio.CancelledError):await task
    assert [op for op,_ in host.calls]==["media.submit","media.lookup","media.cancel"]
    assert host.calls[0][1]["requestId"]==host.calls[1][1]["requestId"]
    assert host.calls[2][1]["jobId"]=="admitted"


def test_media_provider_configuration_is_closed_while_search_stays_app_owned():
    from deeptutor.services.config import provider_runtime
    for name in ("tts","stt","imagegen","videogen"):
        with pytest.raises(ValueError,match="Nimi"):
            getattr(provider_runtime,f"resolve_{name}_runtime_config")({"services":{}})
    assert "duckduckgo" in provider_runtime.SEARCH_PROVIDERS


def test_catalog_media_writes_are_rejected_without_blocking_search_changes():
    from fastapi import HTTPException
    from deeptutor.api.routers.settings import _require_nimi_catalog_unchanged
    original={"services":{"tts":{"profiles":[]},"search":{"active":"old"}}}
    _require_nimi_catalog_unchanged({"services":{"tts":{"profiles":[]},"search":{"active":"new"}}},original)
    with pytest.raises(HTTPException) as exc:
        _require_nimi_catalog_unchanged({"services":{"tts":{"profiles":[{"api_key":"test"}]}}},original)
    assert exc.value.status_code==400
    configured={"services":{"tts":{"profiles":[{"id":"old","api_key":"before"}]}}}
    with pytest.raises(HTTPException):
        _require_nimi_catalog_unchanged({"services":{"tts":{"profiles":[{"id":"old","api_key":"after"}]}}},configured)
