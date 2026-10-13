# 1.6.14 — Windows candidate (unreleased)

The current source also moves the existing read-aloud, microphone transcription and image/video chat tools to Nimi model configuration and protected Jobs. Media transfer is chunked, and conversation-backed task recovery observes the original submission rather than repeating generation. The old App media-provider configuration and direct execution are closed. This media source checkpoint passes 14 Node tests, 50 Python tests and Host/frontend typechecks; production packaging and real media acceptance remain NOT-VERIFIED. Previously generated packages do not contain these changes.

Adds the Windows production target and correct executable/venv paths. The App-owned worker uses one UTF-8 stdin/stdout protocol on both platforms, and shutdown terminates the exact owned Windows child tree. Python setup, renderer builds and guarded development use portable entry points. Public SDK 0.21.0, Kit/native 0.19.3 and App Tools 0.12.2 are used. The real frozen Windows backend passed authenticated HTTP, origin rejection and Chinese notebook persistence checks. Supervised MiMo learning chat passed; Catalog installation of this candidate remains NOT-VERIFIED.

# Nimi release 1.6.13 — Packaged knowledge indexing

Includes tiktoken encoding plugins in the frozen Python backend. This fixes the Catalog-only `Unknown encoding cl100k_base` failure during knowledge-base indexing. Public Kit/native 0.19.2 and Runtime identity checks are unchanged.

# Nimi release 1.6.12 — Source Runtime support for Catalog Apps

Updates the frozen public npm dependency to Kit/native 0.19.2. The installed App keeps its published native carrier and can connect to a source-development Runtime when launched through Home. Native peer identity checks and Runtime-owned installed-source, session and App Access admission remain mandatory. Production Runtime trust remains unchanged; invalid source Runtime observations fail closed without fallback. SDK 0.21.0, App Tools 0.12.0 and the existing App business workflows are retained.

# Nimi release 1.6.11

DeepTutor now consumes the published Nimi SDK 0.21.0, Kit 0.19.0, App Tools 0.12.0 and Nimi Coding 0.6.5 with frozen public npm dependencies. Knowledge indexing and retrieval explicitly use their document and query embedding purposes. Fresh build hosts prepare the Python toolchain before tests and packaging.

Desktop-supervised learning replies, document indexing, grounded knowledge retrieval and saved work were exercised on macOS arm64. This release declares macOS arm64; no Windows interactive acceptance is claimed.
