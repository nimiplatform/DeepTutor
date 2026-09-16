import asyncio
from contextlib import suppress
import json
import socket

import pytest

from deeptutor.nimi.transport import HostTransport, NimiRequestError
from deeptutor.services.llm.exceptions import LLMProviderError


@pytest.fixture
def channel():
    worker, host = socket.socketpair()
    reader = worker.makefile("rb")
    host_reader = host.makefile("rb")
    transport = HostTransport(worker, reader, 1)
    yield transport, host, host_reader
    with suppress(OSError):
        worker.shutdown(socket.SHUT_RDWR)
    host.close()
    host_reader.close()
    reader.close()
    worker.close()


async def receive(reader):
    return json.loads((await asyncio.to_thread(reader.readline)).decode("utf-8", "strict"))


def send(host, value):
    host.sendall((json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8", "strict"))


@pytest.mark.asyncio
async def test_explicit_cancel_reaches_host(channel):
    transport, _host, reader = channel
    task = asyncio.create_task(transport.request("text.step", {"messages": ["中文"]}))
    request = await receive(reader)
    assert request["input"]["messages"] == ["中文"]
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    cancelled = await receive(reader)
    assert cancelled == {"v": 1, "kind": "cancel", "id": request["id"], "generation": 1}


@pytest.mark.asyncio
async def test_scope_invalidation_rejects_late_results_and_requires_a_new_request(channel):
    transport, host, reader = channel
    old = asyncio.create_task(transport.request("text.step", {"messages": ["old"]}))
    request = await receive(reader)
    send(host, {"v": 1, "kind": "scope-invalidated", "generation": 2})
    send(host, {"v": 1, "kind": "result", "id": request["id"], "generation": 1, "value": "stale"})
    with pytest.raises(LLMProviderError, match="session changed"):
        await old
    assert (await receive(reader))["kind"] == "cancel"
    new = asyncio.create_task(transport.request("text.step", {"messages": ["new"]}))
    next_request = await receive(reader)
    assert next_request["generation"] == 2
    assert next_request["id"] != request["id"]
    send(
        host,
        {"v": 1, "kind": "result", "id": request["id"], "generation": 1, "value": "stale again"},
    )
    send(
        host,
        {
            "v": 1,
            "kind": "result",
            "id": next_request["id"],
            "generation": 2,
            "value": "新作用域的结果",
        },
    )
    assert await new == "新作用域的结果"


@pytest.mark.asyncio
async def test_backend_host_disconnect_has_its_own_failure(channel):
    transport, host, reader = channel
    task = asyncio.create_task(transport.request("embedding.batch", {"inputs": ["学习"]}))
    await receive(reader)
    host.shutdown(socket.SHUT_WR)
    with pytest.raises(LLMProviderError) as error:
        await task
    assert error.value.details["reasonCode"] == "DEEPTUTOR_HOST_DISCONNECTED"


@pytest.mark.asyncio
async def test_typed_failure_preserves_partial_evidence_without_rendering_internal_details(channel):
    transport, host, reader = channel
    task = asyncio.create_task(transport.request("text.step", {"messages": []}))
    request = await receive(reader)
    send(
        host,
        {
            "v": 1,
            "kind": "delta",
            "id": request["id"],
            "generation": 1,
            "value": {"text": "partial"},
        },
    )
    send(
        host,
        {
            "v": 1,
            "kind": "error",
            "id": request["id"],
            "generation": 1,
            "value": {
                "message": "message role",
                "reasonCode": "SDK_LOCAL_APP_INPUT_INVALID",
                "actionHint": "internal",
            },
        },
    )
    with pytest.raises(NimiRequestError) as error:
        await task
    assert error.value.error_code == "SDK_LOCAL_APP_INPUT_INVALID"
    assert error.value.partial_response is True
    assert error.value.retryable is False
    assert "DeepTutor sent a model request" in str(error.value)
    assert "actionHint" not in str(error.value)
    assert error.value.details["actionHint"] == "internal"
