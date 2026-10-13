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


@pytest.mark.asyncio
async def test_read_aloud_uses_the_saved_app_voice_choice(monkeypatch):
    from deeptutor.api.routers import voice
    from deeptutor.services.settings import interface_settings
    calls=[]
    async def synthesize(text,**kwargs):
        calls.append((text,kwargs));return b"test-audio-bytes","audio/mpeg"
    class Request:
        async def is_disconnected(self):return False
    monkeypatch.setattr(voice,"synthesize_speech",synthesize)
    monkeypatch.setattr(interface_settings,"get_ui_settings",lambda:{"nimi_speech_voice":"user-selected-preset"})
    response=await voice.text_to_speech(voice.TTSRequest(text="Read this"),Request())
    assert response.body==b"test-audio-bytes"
    assert calls==[("Read this",{"voice":"user-selected-preset","response_format":None})]


def test_settings_readiness_uses_nimi_selection_states_without_provider_credentials():
    from deeptutor.services.config.readiness import nimi_catalog_service_rows
    rows={row["id"]:row for row in nimi_catalog_service_rows([
        {"capabilityContract":"text.generate","state":"ready"},
        {"capabilityContract":"image.generate","state":"ready"},
        {"capabilityContract":"audio.synthesize","state":"unavailable"},
    ])}
    assert rows["catalog.llm"]["state"]=="enabled_verified"
    assert rows["catalog.task"]["state"]=="enabled_verified"
    assert rows["catalog.imagegen"]["state"]=="enabled_verified"
    assert rows["catalog.tts"]["detail_code"]=="nimi_model_unavailable"
    assert rows["catalog.stt"]["state"]=="not_selected"
    disconnected={row["id"]:row for row in nimi_catalog_service_rows(None)}
    assert disconnected["catalog.llm"]["detail_code"]=="nimi_model_unavailable"


@pytest.mark.asyncio
async def test_post_generation_save_failure_stops_the_model_instead_of_retrying_paid_work(monkeypatch):
    from deeptutor.tools import media_gen_tool
    from deeptutor.services import imagegen
    calls=[]
    async def generate(*args,**kwargs):calls.append(kwargs);return [(b"image-bytes","image/png")]
    async def fail_save(*args):raise OSError(206,"Filename too long")
    monkeypatch.setattr(imagegen,"generate_image",generate)
    monkeypatch.setattr(media_gen_tool,"action_for_tool",lambda *args:media.MediaAction("session","original"))
    monkeypatch.setattr(media_gen_tool,"save_generated_media",fail_save)
    result=await media_gen_tool.ImagegenTool().execute(prompt="diagram",n=1)
    assert len(calls)==1
    assert result.success is False and result.terminate_turn is True
    assert "Check original task" in result.content


@pytest.mark.skipif(__import__("os").name != "nt", reason="Windows extended path I/O")
def test_workspace_publication_handles_long_windows_host_profile_paths(tmp_path,monkeypatch):
    from deeptutor.services.path_service import PathService
    from deeptutor.services.workspace import service as workspace_module
    short_paths=PathService(workspace_root=tmp_path/"host-profile-")
    padding=max(0,220-len(str(short_paths.get_workspace_dir())))
    paths=PathService(workspace_root=tmp_path/("host-profile-"+"x"*padding))
    paths.ensure_all_directories()
    monkeypatch.setattr(workspace_module,"get_path_service",lambda:paths)
    monkeypatch.delenv("DEEPTUTOR_WORKSPACE_ROOT",raising=False)
    monkeypatch.delenv("DEEPTUTOR_WORKSPACE_ALLOWED_ROOTS",raising=False)
    service=workspace_module.ContentWorkspaceService();binding=service.current_binding(ensure_output=True)
    assert len(str(binding.root/"outputs"/(".deeptutor-write-probe-"+"0"*32)))>260
    original=binding.root/"outputs"/"中文.png"
    original.write_bytes(b"preserved-media-bytes")
    item=service.publish(binding,[{"path":"outputs/中文.png"}])[0]
    saved,projection=service.resolve_published_item(binding.workspace_id,item.workspace_item_id)
    assert len(str(saved))>260
    assert saved.read_bytes()==original.read_bytes()
    assert projection.url.startswith("/files/workspace-items/")
    assert "\\\\?\\" not in projection.url


@pytest.mark.asyncio
async def test_cancel_that_races_with_completion_does_not_claim_cancel_or_start_export(tmp_path,monkeypatch):
    store=SQLiteSessionStore(tmp_path/"sessions.sqlite");await store.create_session("Media","session")
    monkeypatch.setattr("deeptutor.services.session.get_session_store",lambda:store)
    action=media.MediaAction("session","original")
    await action.save({"requestId":"original","type":"image-generate","parameters":{"prompt":"diagram"},"status":"running"})
    class Host:
        calls=[]
        async def request(self,operation,value):
            self.calls.append(operation)
            return {"jobId":"job","scenarioType":"image-generate","status":"completed","artifacts":[]}
    host=Host();monkeypatch.setattr(media,"get_transport",lambda:host)
    result=await media.recover_action("session","original",cancel=True)
    assert result["status"]=="completed"
    assert host.calls==["media.lookup"]
