import pytest

from deeptutor.nimi.http_auth import HostAuthentication


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["http", "websocket"])
@pytest.mark.parametrize(
    "cookie,origin,allowed",
    [
        (None, None, False),
        ("deeptutor_host=wrong", None, False),
        ("deeptutor_host=secret", "http://foreign.test", False),
        ("deeptutor_host=secret", "http://127.0.0.1:1467", True),
        ("deeptutor_host=secret", None, True),
    ],
)
async def test_app_http_requires_own_caller_and_origin(kind, cookie, origin, allowed):
    entered = []
    sent = []

    async def application(scope, receive, send):
        entered.append(scope)

    async def send(message):
        sent.append(message)

    headers = []
    if cookie:
        headers.append((b"cookie", cookie.encode()))
    if origin:
        headers.append((b"origin", origin.encode()))
    middleware = HostAuthentication(application, "secret", "http://127.0.0.1:1467")
    await middleware({"type": kind, "headers": headers}, None, send)
    assert bool(entered) is allowed
    if not allowed:
        if kind == "http":
            assert sent[0]["status"] == 401
        else:
            assert sent[0] == {"type": "websocket.close", "code": 4401}
