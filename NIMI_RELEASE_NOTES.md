# 1.6.14 — Windows and Nimi media support

The current source moves read-aloud, microphone transcription and existing image/video chat tools to Nimi configuration and protected Jobs. Media transfer is chunked, conversation-backed recovery observes the original submission, and App-owned media provider controls are closed. Real Windows image/video generation, original-Job recovery, cancellation, downloads, video playback and reopening passed after correcting Win32 long paths. The user also completed real microphone transcription, with the HTTP 200 transcript shown unchanged in the composer and left unsent. Read-aloud passed with published Kit 0.20.0 and Nimi 0.2.3-rc.2: the original Chinese answer produced 182.72 seconds of playable 24 kHz WAV, browser playback and Stop worked, and the actual output fully decoded. The Windows production build now includes this media work, and its new frozen backend passed the authenticated HTTP and notebook persistence checks. Installed-App acceptance remains pending.

Adds the Windows production target and correct executable/venv paths. The App-owned worker uses one UTF-8 stdin/stdout protocol on both platforms, and shutdown terminates the exact owned Windows child tree. Python setup, renderer builds and guarded development use portable entry points. Public SDK 0.21.0, Kit/native 0.20.0 and App Tools 0.12.3 are used. The real frozen Windows backend passed authenticated HTTP, origin rejection and Chinese notebook persistence checks. Supervised MiMo learning chat passed; Catalog installation of this candidate remains NOT-VERIFIED. The publisher's safety declaration is included.

# Nimi release 1.6.13 — Packaged knowledge indexing

Includes tiktoken encoding plugins in the frozen Python backend. This fixes the Catalog-only `Unknown encoding cl100k_base` failure during knowledge-base indexing. Public Kit/native 0.19.2 and Runtime identity checks are unchanged.

# Nimi release 1.6.12 — Source Runtime support for Catalog Apps

Updates the frozen public npm dependency to Kit/native 0.19.2. The installed App keeps its published native carrier and can connect to a source-development Runtime when launched through Home. Native peer identity checks and Runtime-owned installed-source, session and App Access admission remain mandatory. Production Runtime trust remains unchanged; invalid source Runtime observations fail closed without fallback. SDK 0.21.0, App Tools 0.12.0 and the existing App business workflows are retained.

# Nimi release 1.6.11

DeepTutor now consumes the published Nimi SDK 0.21.0, Kit 0.19.0, App Tools 0.12.0 and Nimi Coding 0.6.5 with frozen public npm dependencies. Knowledge indexing and retrieval explicitly use their document and query embedding purposes. Fresh build hosts prepare the Python toolchain before tests and packaging.

Desktop-supervised learning replies, document indexing, grounded knowledge retrieval and saved work were exercised on macOS arm64. This release declares macOS arm64; no Windows interactive acceptance is claimed.
