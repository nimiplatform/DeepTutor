"""Explicit turns on a surviving socket get a fresh Nimi scope, old work does not."""

import asyncio
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from deeptutor.api.routers import auth, unified_ws
from deeptutor.nimi import transport
from deeptutor.nimi.http_auth import HostAuthentication


@pytest.mark.parametrize("command", ["start_turn", "regenerate"])
def test_new_turn_adopts_current_generation_without_rebinding_old_tasks(monkeypatch, command):
    channel = SimpleNamespace(generation=1)
    monkeypatch.setattr(transport, "_transport", channel)
    captured = []
    old_task = None
    release = None

    async def start(*_args, **_kwargs):
        nonlocal old_task, release
        captured.append(transport._scope.get())
        if old_task is None:
            release = asyncio.Event()

            async def old_work():
                await release.wait()
                return transport._scope.get()

            old_task = asyncio.create_task(old_work())
        else:
            release.set()
            assert await old_task == 1
        # End at the admission boundary without fabricating a successful turn.
        raise RuntimeError("scope captured")

    async def allow(_ws):
        return None

    monkeypatch.setattr(auth, "ws_require_auth", allow)
    app = FastAPI()
    app.state.application_container = SimpleNamespace(
        turns=SimpleNamespace(start_turn=start, regenerate_last_turn=start)
    )
    app.include_router(unified_ws.router)
    client = TestClient(HostAuthentication(app, "secret", "http://127.0.0.1:1467"))
    message = {"type": command, "protocol_version": "2.0", "session_id": "session-1"}
    if command == "start_turn":
        message["content"] = "New explicit request"
    with client.websocket_connect("/ws", headers={"cookie": "deeptutor_host=secret"}) as socket:
        socket.send_json(message)
        assert socket.receive_json()["message"] == "scope captured"
        channel.generation = 2
        socket.send_json(message)
        assert socket.receive_json()["message"] == "scope captured"
    assert captured == [1, 2]
