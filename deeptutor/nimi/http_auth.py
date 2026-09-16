"""Authenticate App business HTTP/WS independently of Nimi credentials."""

from __future__ import annotations

from hmac import compare_digest
from http.cookies import SimpleCookie


class HostAuthentication:
    def __init__(self, app, token: str, renderer_origin: str):
        self.app = app
        self.token = token
        self.renderer_origin = renderer_origin

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        cookie = SimpleCookie()
        try:
            cookie.load(headers.get(b"cookie", b"").decode("ascii"))
            item = cookie.get("deeptutor_host")
            valid = item is not None and compare_digest(item.value, self.token)
        except (ValueError, UnicodeError):
            valid = False
        origin = headers.get(b"origin")
        if origin is not None and origin.decode("ascii", "replace") != self.renderer_origin:
            valid = False
        if not valid:
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 4401})
            else:
                await send(
                    {
                        "type": "http.response.start",
                        "status": 401,
                        "headers": [(b"content-type", b"application/json")],
                    }
                )
                await send(
                    {
                        "type": "http.response.body",
                        "body": b'{"detail":"Open DeepTutor through Nimi Desktop."}',
                    }
                )
            return
        from deeptutor.nimi.transport import business_scope

        with business_scope():
            await self.app(scope, receive, send)
