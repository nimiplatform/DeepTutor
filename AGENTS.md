# DeepTutor — Agent-Native Architecture

## Overview

DeepTutor is an **agent-native** intelligent learning companion organized
around a two-layer plugin model — single-shot **Tools** invoked by the
LLM, and multi-stage **Capabilities** that take over a turn — exposed
through three entry points: CLI, WebSocket API, and Python SDK.

## Architecture

```
Entry Points:  CLI (Typer)  |  WebSocket /ws  |  Python SDK
                    ↓                   ↓                   ↓
              ┌─────────────────────────────────────────────────┐
              │              ChatOrchestrator                    │
              │   routes UnifiedContext → selected Capability    │
              │   (defaults to `chat`)                           │
              └──────────┬──────────────┬───────────────────────┘
                         │              │
              ┌──────────▼──┐  ┌────────▼──────────┐
              │ ToolRegistry │  │ CapabilityRegistry │
              │  (Level 1)   │  │   (Level 2)        │
              └──────────────┘  └────────────────────┘
```

All capabilities emit on a shared `StreamBus`; the orchestrator fans
events out to consumers. Runtime settings live in
`data/user/settings/*.json` — project-root `.env` files are intentionally
ignored.

### Level 1 — Tools

Single-function tools the LLM picks on demand. Four user-toggleable tools
surface in `/settings/tools`:

| Tool           | Description                                   |
| -------------- | --------------------------------------------- |
| `brainstorm`   | Breadth-first idea exploration with rationale |
| `web_search`   | Web search with citations                     |
| `paper_search` | arXiv preprint search                         |
| `reason`       | Dedicated deep-reasoning LLM call             |

The rest are **context-gated**: the chat capability auto-mounts them from
`ToolMountFlags` (presence of a KB, attachments, sandbox availability, …), and
any of them can also be force-enabled via `--tool`. Auto-mounted set: `rag`,
`read_source`, `read_memory`, `write_memory`, `read_skill`, `load_tools`,
`exec` (sandboxed Python/C/C++ or shell execution),
`list_notebook`, `write_note`, `web_fetch`, `github`, `cron`,
`ask_user` (pauses the turn and resumes with the user's reply), plus the
mastery-path tools. `geogebra_analysis` is parked under
`COMING_SOON_TOOL_TYPES`.

### Level 2 — Capabilities

Multi-stage pipelines that own the turn:

| Capability       | Stages                                                |
| ---------------- | ----------------------------------------------------- |
| `chat`           | exploring → responding (single agentic loop, default) |
| `mastery_path`   | responding (Guided Learning — chat loop + mastery tools, gated per topic type) |
| `deep_solve`     | planning → reasoning → writing                        |
| `deep_question`  | ideation → generation                                 |
| `deep_research`  | rephrasing → decomposing → researching → reporting    |
| `visualize`      | analyzing → generating → reviewing (SVG / Chart.js / Mermaid / HTML; or routes to Manim sub-stages via `render_type`) |
| `math_animator`  | concept_analysis → concept_design → code_generation → code_retry → summary → render_output |

All capabilities converge on `emit_capability_result()` in
`deeptutor/capabilities/_shared.py` so every turn emits the same envelope
(response payload + `cost_summary` from `UsageTracker`). Status copy and
prompts are i18n'd via `capabilities/prompts/{en,zh}/<name>.yaml`.

## CLI Usage

```bash
# Install
pip install deeptutor      # Full app (CLI + Web/API + packaged Web assets)
pip install deeptutor-cli  # CLI-only

# Run any capability
deeptutor run chat "Explain Fourier transform"
deeptutor run deep_solve "Solve x^2=4" -t rag --kb my-kb
deeptutor run visualize "Animate sine wave" --config render_mode=manim_video

# Interactive REPL
deeptutor chat
# (inside the REPL: /regenerate or /retry re-runs the last user message)

# Partners (IM-connected companions)
deeptutor partner list

# Knowledge bases, memory, server
deeptutor kb list
deeptutor kb create my-kb --doc textbook.pdf
deeptutor memory show
deeptutor serve --port 8001       # API server only
deeptutor start                   # backend + frontend together
```

## Key Files

| Path                                       | Purpose                              |
| ------------------------------------------ | ------------------------------------ |
| `deeptutor/runtime/orchestrator.py`        | `ChatOrchestrator` — unified entry   |
| `deeptutor/runtime/launcher.py`            | Backend + frontend lifecycle / port discovery |
| `deeptutor/runtime/registry/`              | Tool + Capability registries         |
| `deeptutor/runtime/bootstrap/builtin_capabilities.py` | Built-in capability class paths |
| `deeptutor/services/config/runtime_settings.py` | JSON settings + process-env overrides |
| `deeptutor/core/stream.py`, `stream_bus.py` | StreamEvent protocol + async fan-out |
| `deeptutor/core/tool_protocol.py`          | `BaseTool` + `ToolDefinition`         |
| `deeptutor/core/capability_protocol.py`    | `BaseCapability` + `CapabilityManifest` |
| `deeptutor/core/context.py`                | `UnifiedContext` dataclass            |
| `deeptutor/tools/builtin/__init__.py`      | All built-in tool wrappers           |
| `deeptutor/capabilities/`                  | Built-in capability implementations  |
| `deeptutor/app.py`                         | `DeepTutorApp` — Python SDK facade    |
| `deeptutor_cli/main.py`                    | Typer CLI entry point                |
| `deeptutor/api/routers/unified_ws.py`      | Unified WebSocket endpoint           |

## Dependency Layers

Public install paths and source extras are defined in `pyproject.toml`.
Requirements files mirror the same dependency groups for Docker/CI installs.

```
pip install deeptutor      — Full app (CLI + Web/API + packaged Web assets)
pip install deeptutor-cli  — CLI-only (LLM + RAG + providers + document parsing)
pip install -e .           — Source install for development

Source extras (.[ extra ], defined in pyproject.toml):
.[cli]            — CLI-only dependency set
.[server]         — Web/API server dependencies
.[partners]       — Partner channel SDKs  (legacy alias: .[tutorbot])
.[matrix]         — Matrix channel for Partners (matrix-nio; needs libolm)
.[matrix-e2e]     — Matrix with end-to-end encryption (matrix-nio[e2e])
.[math-animator]  — Manim addon (powers `visualize` Manim renders + `deeptutor run math_animator`)
.[dev]            — Test / lint tooling
.[all]            — Everything above
```

<!-- nimicoding:managed:agents:start -->
# Nimi Coding Managed Block

- From the repository root, invoke the pinned project-local CLI as `pnpm exec nimicoding`; do not probe or rely on a global `nimicoding` binary in `PATH`.
- Product authority lives under `.nimi/spec/**`.
- Choose authority and code queries when their declared scope can resolve an uncertainty that affects the current task; reuse sufficient current evidence. Query scope is not the limit of host reasoning or authorized work, and hypotheses are not product authority.
- For canonical authority authoring, read only `.nimi/methodology/authority-authoring.yaml`, the affected authority files or bounded task context, and CLI diagnostics.
- Use `pnpm exec nimicoding authority context <path> <id> --max-units <n> --max-bytes <n> --json` only for the complete declared outgoing interpretation closure; it is not complete task context, and failure never permits guessed or partial context.
- Use `pnpm exec nimicoding authority diff` and `pnpm exec nimicoding authority impact` with explicit `--max-bytes`; impact reports declared review obligations and does not prove implementation, consumers, or tests are synchronized.
- Use `pnpm exec nimicoding authority change-candidates` only with explicit channels and budgets; its complete union is recall input, never conflict, retirement, absence, authority, or conformance judgment.
- When explicit authority links are needed, use `pnpm exec nimicoding code authority --repo <root> --authority <id> --max-files <n> --max-bytes <n>` to locate annotated code, and use `--source <path>` for code-to-authority lookup. Results cover only explicit markers and authority lifecycle; they do not prove implementation conformance or evaluate unannotated code.
- For a new or changed authority-governed feature, add the reserved standalone physical line `// @nimi-authority: <exact-id>` in TypeScript/TSX, Go, or Rust, and `# @nimi-authority: <exact-id>` in Python. The scanner does not prove language comment context, so use this reserved form only for intentional links at a few key semantic owners.
- Use `// @nimi-deprecated: <exact-id>`, or `# @nimi-deprecated: <exact-id>` in Python, only after direct authority evidence or a real product failure confirms obsolete semantics; find it with `pnpm exec nimicoding code authority --repo <root> --audit --max-files <n> --max-bytes <n>` and remove it with the hard cut.
- When a selected TypeScript or TSX consumer still has a static-dependency question, use `pnpm exec nimicoding code context <path> --repo <root> --symbol <identifier> --tsconfig <path> --max-bytes <n>` for bounded root-direct static dependencies; it is not inbound impact, runtime dispatch, or complete task context.
- Use `pnpm exec nimicoding sync --check` to diagnose drift in package-owned managed projections, `pnpm exec nimicoding sync --apply` to restore them, and `pnpm exec nimicoding doctor` to diagnose package/managed compatibility. These commands do not validate product authority, implementation conformance, or task readiness.
- Under `.nimi/spec/**`, author only closed multi-unit `*.authority.yaml` containers or single-unit `*.authority.md`; historical document formats are unsupported and never inferred.
- Run `pnpm exec nimicoding authority fmt` on each changed file, then `pnpm exec nimicoding authority check` on the complete authority input set.
- A failed project-local `pnpm exec nimicoding ...` invocation supplies no usable result. Pause decisions that require refused, missing, or incomplete results; continue independent authorized work. Never substitute guessed, corpus-wide, or fallback context, or treat diagnostics or partial output as complete context; choose repair values only from product/task authority.
- Keep derived and local verification output under `.nimi/local/**`; it is never product authority.
<!-- nimicoding:managed:agents:end -->

<!-- nimi-app:managed:start -->
## Nimi App development

- For auditing adaptation feasibility or cost, creating, adapting, upgrading or releasing this App, read [the lifecycle skill](.agents/skills/nimi-app-lifecycle/SKILL.md) and only the relevant scenario. Audit-only requests do not begin implementation; prior reports remain evidence-dependent.
- For first integration or foundation wiring changes, use the selected app-tools package's generated reference and reuse its Host, preload, renderer, session, App Access, AIConfig and AI call wiring. Follow the adaptation guide's baseline checks and reuse passing results for ordinary business edits.
- Keep App-owned product behavior, Host code, business accounts and non-AI services with this repository. Use the SDK/Kit Local App carrier for Nimi AI, configuration, storage and session access.
- Development may consume complete local npm tarballs through the supported explicit overrides and version matrix; public-release preflight uses registry resolutions. Do not substitute source-workspace or directory links.
- App Tools owns its lifecycle skill, this block, managed workflow and declared engineering fields; preserve other instructions, product source and licenses. Existing adoption does not create fresh scaffold intent or lock.
- Product-operation guides apply to their specific business tasks; they do not replace the Nimi development boundary.
- Reuse the user's confirmed scope and authorization. Report command checks separately from actual App journeys; unrun relevant paths remain NOT-VERIFIED.
<!-- nimi-app:managed:end -->
