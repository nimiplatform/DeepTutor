import "server-only"
import { apiFetch } from "@/shared/api/client"
import { readFileSync } from "node:fs"
import {
    isWebCoordinationPath,
    readWebDevelopment,
} from "@nimiplatform/app-tools/web"
import { parse } from "yaml"

function unavailable(message: string, status: number) {
    return new Response(message, {
        status,
        headers: { "Cache-Control": "no-store" },
    })
}

// The Next server forwards account/signalling coordination only. AI and Runtime
// operations stay on the browser's admitted direct carrier.
export async function forwardNimiCoordination(
    request: Request,
): Promise<Response> {
    if (process.env.NIMI_DEEPTUTOR_CARRIER !== "web")
        return unavailable("Not found", 404)
    const { site, realm } = readWebDevelopment(
        parse(readFileSync("../nimi.app.yaml", "utf8")),
    )
    const source = new URL(request.url)
    if (!isWebCoordinationPath(request.method, source.pathname))
        return unavailable("Not found", 404)
    const origin = request.headers.get("origin")
    // Next normalizes Request.url's hostname to localhost in its HTTPS dev
    // server. The incoming Host and browser Origin identify the declared site.
    if (
        source.protocol !== site.protocol ||
        request.headers.get("host") !== site.host ||
        (origin !== null && origin !== site.origin)
    ) {
        return unavailable("Origin is not allowed", 403)
    }
    const headers = new Headers()
    for (const name of ["accept", "authorization", "content-type", "origin"]) {
        const value = request.headers.get(name)
        if (value !== null) headers.set(name, value)
    }
    let upstream: Response
    try {
        upstream = await apiFetch(
            new URL(source.pathname + source.search, realm),
            {
                method: request.method,
                credentials: "omit",
                skipAuthRedirect: true,
                headers,
                redirect: "manual",
                body:
                    request.method === "POST"
                        ? await request.arrayBuffer()
                        : undefined,
                signal: request.signal,
            },
        )
    } catch {
        return unavailable("Realm coordination is unavailable", 502)
    }
    if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel()
        return unavailable("Unexpected coordination redirect", 502)
    }
    const responseHeaders = new Headers({ "Cache-Control": "no-store" })
    for (const name of ["content-type", "retry-after"]) {
        const value = upstream.headers.get(name)
        if (value !== null) responseHeaders.set(name, value)
    }
    return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
    })
}
