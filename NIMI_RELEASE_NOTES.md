# Unreleased — Windows knowledge-index startup

Loads the required FAISS native library before starting the Host's background
stdin reader on Windows. The installed 1.6.17 worker stalled inside FAISS's
OpenBLAS DLL import after document embedding, then reported an indexing timeout.
A real subprocess regression reproduces the hang before this change and completes
native vector insertion/search afterward. All 15 Nimi Node tests and 55 Python
tests pass.

On Nimi 0.2.3, the existing Desktop-supervised development registration passed
the real workflow through its own loopback CDP: upload the 696-byte Chinese Q58
document, publish a 1024-dimensional index, retrieve its facts through the model,
save the answer to a notebook, close the App and reopen the same registration.
The answer correctly retained all seven requested facts and declined to invent
the absent budget or team size. The index remained Ready and the notebook record
remained present after reopening. A rebuilt installed package containing this
fix is NOT-VERIFIED; no new release is claimed by these development results.

# 1.6.17 — Relocatable Windows renderer dependencies

Uses pnpm's hoisted layout with the existing frozen dependency versions so
Windows packaging cannot flatten Next's dependency links into an incomplete
module layout. Build, development and validation scripts resolve their tools
and PDF.js resources from the installed packages. Production packaging now
starts a copy of the actual Next resources outside the checkout, checks its
HTML response and stops the owned process tree; test caches stay out of the
final package. This check reproduced the installed 1.6.16 missing-SWC failure
and passes on the corrected renderer. Local production 1.6.17 was imported into
Nimi 0.2.3 and its installed UI launched successfully; its knowledge-index run
exposed the Windows FAISS startup issue described above. The dual-platform
1.6.17 release workflow succeeded. Immutable earlier releases remain unchanged.

Frontend Node tests now use the installed tsx runner and the App's TypeScript
configuration, with type checking retained. Windows filesystem comparisons
normalize separators, build assertions follow the Nimi workspace/dev layout,
and generated-contract checks tolerate Git's CRLF checkout without ignoring
content changes. All 1,138 frontend Node tests pass; the App release test command
now includes them and the contract check alongside the 14 Nimi Node and 55
Python tests.

# 1.6.16 — Cross-platform worker test cleanup

The real backend-process test now starts its own process group, matching the
production Host. The Unix cleanup helper sends signals to that owned group;
the previous test omitted it and hung during cleanup on macOS. Its 45-second
test timeout did not terminate the leaked child. The Windows authenticated
backend/notebook-persistence regression passes with the corrected fixture.
Version 1.6.15's Windows release build passed, but the stalled macOS run was
canceled. Its tag remains unchanged. App business code and media results are
unchanged; installed acceptance remains pending.

# 1.6.15 — Reproducible Windows decoder assets

PDF.js decoder files and their licenses now come solely from the frozen dependency during development and production builds. They are already declared as generated assets in the ignore rules; removing the remaining tracked copies prevents the Windows clean-source check from failing after they are regenerated. The decoder resources remain in the packaged App. Version 1.6.14 completed its Windows build but failed the source-tree check, so its tag is retained without a completed release. The media implementation and real acceptance results below are unchanged.

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
