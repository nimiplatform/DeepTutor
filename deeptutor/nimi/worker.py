"""App-owned FastAPI process entry; Electron owns its lifetime."""

from __future__ import annotations

import argparse
import json
import os
import socket


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True, type=int)
    arguments = parser.parse_args()
    if not 1024 <= arguments.port <= 65535:
        parser.error("backend port must be in 1024..65535")
    if not os.environ.get("DEEPTUTOR_HOME"):
        parser.error("the App Host must supply a writable DEEPTUTOR_HOME")
    # A dedicated inherited pipe carries bounded App business messages. UTF-8
    # decoding is explicit even in the frozen worker; stdout remains logs.
    channel = socket.socket(fileno=3)
    channel.set_inheritable(False)
    reader = channel.makefile("rb")
    line = reader.readline(4097)
    configuration = json.loads(line.decode("utf-8", "strict"))
    if (
        configuration.get("type") != "initialize"
        or not isinstance(configuration.get("apiToken"), str)
        or len(configuration["apiToken"]) != 64
    ):
        parser.error("invalid App Host initialization")

    import uvicorn

    from deeptutor.nimi.transport import install_transport

    install_transport(channel, reader, configuration.get("generation", 1))
    from deeptutor.api.main import app
    from deeptutor.nimi.http_auth import HostAuthentication

    guarded_app = HostAuthentication(
        app, configuration["apiToken"], configuration["rendererOrigin"]
    )
    uvicorn.run(guarded_app, host="127.0.0.1", port=arguments.port, access_log=False, workers=1)


if __name__ == "__main__":
    main()
