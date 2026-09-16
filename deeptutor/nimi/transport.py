"""Bounded UTF-8 child protocol, shared safely by Python async/thread workers."""

from __future__ import annotations

import asyncio
from contextlib import aclosing, contextmanager
from contextvars import ContextVar
import json
import socket
import threading
from uuid import uuid4

from deeptutor.services.llm.exceptions import LLMProviderError

MAX_FRAME_BYTES = 2 * 1024 * 1024
_scope: ContextVar[int | None] = ContextVar("deeptutor_nimi_generation", default=None)
_transport: HostTransport | None = None


class NimiRequestError(LLMProviderError):
    """Keep the public failure code while rendering a readable business error."""

    def __init__(self, failure, *, partial_response=False):
        super().__init__(failure["message"], details=failure, provider="nimi")
        self.error_code = failure.get("reasonCode", "DEEPTUTOR_AI_REQUEST_FAILED")
        self.partial_response = partial_response
        self.retryable = (failure.get("interruption") or {}).get(
            "resubmitDisposition"
        ) == "caller-may-resubmit"

    def __str__(self):
        if self.error_code == "SDK_LOCAL_APP_INPUT_INVALID":
            message = "DeepTutor sent a model request that Nimi could not accept. Please report this App error."
        elif self.error_code == "runtime-service-unavailable":
            message = (
                "Nimi is unavailable. Choose Reconnect Nimi in the sidebar, then send your request again. "
                "The interrupted request has not been replayed."
            )
        else:
            message = self.message
        trace = self.details.get("traceId")
        return f"{message} ({self.error_code}" + (f"; trace {trace}" if trace else "") + ")"


class HostTransport:
    def __init__(self, channel: socket.socket, reader, generation: int):
        self.channel = channel
        self.reader = reader
        self.generation = generation
        self.closed = False
        self._lock = threading.RLock()
        self._pending: dict[str, tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = {}
        threading.Thread(target=self._read, name="deeptutor-host-reader", daemon=True).start()

    def _send(self, frame):
        wire = (
            json.dumps(frame, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"
        ).encode("utf-8", "strict")
        if len(wire) > MAX_FRAME_BYTES:
            raise LLMProviderError("DeepTutor model request exceeds the Host frame limit.")
        with self._lock:
            if self.closed:
                raise LLMProviderError(
                    "DeepTutor Host disconnected; reopen the App from Nimi Desktop."
                )
            self.channel.sendall(wire)

    def _deliver(self, request_id, frame):
        with self._lock:
            pending = self._pending.get(request_id)
        if pending:
            loop, queue = pending

            def enqueue():
                if queue.full():
                    while not queue.empty():
                        queue.get_nowait()
                    queue.put_nowait(
                        {"kind": "error", "value": {"message": "Host stream consumer overflow."}}
                    )
                else:
                    queue.put_nowait(frame)

            if not loop.is_closed():
                loop.call_soon_threadsafe(enqueue)

    def _fail_pending(self, message, reason_code="DEEPTUTOR_SCOPE_INVALIDATED"):
        with self._lock:
            ids = list(self._pending)
        for request_id in ids:
            self._deliver(
                request_id,
                {"kind": "error", "value": {"message": message, "reasonCode": reason_code}},
            )

    def _read(self):
        try:
            while True:
                line = self.reader.readline(MAX_FRAME_BYTES + 1)
                if not line:
                    break
                if len(line) > MAX_FRAME_BYTES or not line.endswith(b"\n"):
                    raise ValueError("Invalid Host frame size")
                frame = json.loads(line.decode("utf-8", "strict"))
                if frame.get("v") != 1:
                    raise ValueError("Unsupported Host protocol")
                if frame.get("kind") == "scope-invalidated":
                    self.generation = frame["generation"]
                    self._fail_pending(
                        "Nimi session changed. Start a new learning turn; interrupted work is not replayed."
                    )
                elif frame.get("generation") == self.generation:
                    self._deliver(frame.get("id"), frame)
        except (OSError, UnicodeError, ValueError):
            pass
        finally:
            self.closed = True
            self._fail_pending(
                "The DeepTutor Host connection ended.", "DEEPTUTOR_HOST_DISCONNECTED"
            )

    async def events(self, operation: str, value):
        if operation not in {"text.step", "embedding.batch"}:
            raise ValueError("Unsupported business operation")
        generation = _scope.get()
        if generation is None:
            generation = self.generation
        if generation != self.generation:
            raise LLMProviderError("Nimi session changed. Reconnect and start a new learning turn.")
        request_id = str(uuid4())
        queue = asyncio.Queue(maxsize=4096)
        with self._lock:
            self._pending[request_id] = (asyncio.get_running_loop(), queue)
        finished = False
        partial_response = False
        try:
            self._send(
                {
                    "v": 1,
                    "kind": "request",
                    "id": request_id,
                    "generation": generation,
                    "operation": operation,
                    "input": value,
                }
            )
            while True:
                frame = await queue.get()
                if frame["kind"] == "error":
                    failure = frame["value"]
                    raise NimiRequestError(failure, partial_response=partial_response)
                if self.generation != generation:
                    raise LLMProviderError(
                        "Nimi session changed before the model result was accepted."
                    )
                if frame["kind"] == "result":
                    finished = True
                    yield frame
                    break
                if frame["kind"] == "delta":
                    partial_response = True
                yield frame
        finally:
            with self._lock:
                self._pending.pop(request_id, None)
            if not finished and not self.closed:
                self._send({"v": 1, "kind": "cancel", "id": request_id, "generation": generation})

    async def request(self, operation, value):
        async with aclosing(self.events(operation, value)) as events:
            async for frame in events:
                if frame["kind"] == "result":
                    return frame["value"]
        raise LLMProviderError("Host stream ended without a completed result.")


def install_transport(channel, reader, generation):
    global _transport
    _transport = HostTransport(channel, reader, generation)
    return _transport


def get_transport() -> HostTransport:
    if _transport is None or _transport.closed:
        raise LLMProviderError(
            "AI is available through the supervised DeepTutor App. Open it from Nimi Desktop.",
            provider="nimi",
        )
    return _transport


@contextmanager
def business_scope():
    token = _scope.set(_transport.generation if _transport else None)
    try:
        yield
    finally:
        _scope.reset(token)
