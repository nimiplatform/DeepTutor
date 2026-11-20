# DeepTutor on Nimi

Study documents, ask grounded questions, organize reading materials and keep learning notes in the DeepTutor workspace. Nimi supplies account sign-in, App authorization and AI model access.

## Start learning on PC

1. Open DeepTutor from Nimi Home and keep Nimi running.
2. Open **Nimi models** in chat or **Settings → Models & services**. Select a text model (`text.generate`) for tutoring and writing; Knowledge Center indexing and document retrieval also require a text-embedding model (`text.embed`). Optional read-aloud (`audio.synthesize`), microphone transcription (`audio.transcribe`), image generation (`image.generate`) and video generation (`video.generate`) use their corresponding Nimi selections.
3. Start a conversation, or import and index study materials in **Knowledge Center** before asking grounded questions with source citations.
4. Save useful answers or passages to **Notebooks**, study documents in **Reading**, or export conversations and notebooks as Markdown.

Choose a model that supports the controls required by the current task. A rejected model request is reported directly as an error; DeepTutor does not silently substitute another model. After changing the embedding model, re-index existing knowledge bases before running retrieval queries.

## Use from a browser

The hosted Web entry at https://deeptutor.nimi.xyz (also reachable from https://nimi.ai/apps/deeptutor once published and admitted) connects to your running PC DeepTutor workspace rather than storing a separate cloud library.

Prerequisites for Web access:

1. Install and run **DeepTutor 1.6.20 or later** on your PC from Nimi Home under the same Nimi account. Earlier Catalog packages (such as 1.6.18) do not provide the `deeptutor.workspace.v3` Integration required by the Web workspace.
2. Sign in on the official Nimi sign-in page, confirm the browser source in Nimi Home on your PC, and grant the **DeepTutor learning workspace** (`deeptutor.workspace.v3`) operations in **Nimi Home → Integrations**.

Web model pages display the active PC model choices in read-only form; change AI models, web-search credentials, subagent settings and local folders in the PC App. If DeepTutor's own multi-user login is enabled on the PC, that business login still applies inside the workspace. Reloading the Web entry requires signing in again, and reconnecting reads saved PC sessions, citations and notebooks without replaying or resubmitting earlier turns.

## Data handling and limitations

- **PC custody**: Conversations, uploaded documents, vector indexes, notebooks, reading workspaces, books, tasks, calendar items and App settings stay on your PC inside `<Nimi data root>/app-hosts/*/apps/*/user-data/workspace/**`. Uninstalling the App package in Nimi removes the managed executable package while leaving that workspace folder untouched until you delete it yourself.
- **Browser storage**: Exported files downloaded from the browser are saved on the browser device. Unsent browser drafts and imported browser-side preferences stay in that browser, partitioned by the verified workspace identity.
- **Version display**: The in-App About badge reflects the upstream DeepTutor core version (`1.7.4`), while Nimi Home displays the Nimi App package version (`1.6.20`).
- **Optional external tools**: Web search providers, optional local CLI subagents and Manim/FFmpeg rendering remain user-configured on the PC and are unavailable until configured there.

## Android development preview

The local Android preview connects to the same PC workspace (`deeptutor.workspace.v3`) and requires both the PC App (`1.6.20` or later) and its configured local HTTPS service to stay running. Sign in through the system browser, return to DeepTutor, and approve the Android source and Integration access in Nimi Home. Saved conversations, Markdown export via Android's system Save picker and explicit attachment handoff are supported; offline use, Android microphone capture and generated-media playback remain unverified.

## Help and license

DeepTutor is licensed under Apache-2.0, based on upstream https://github.com/HKUDS/DeepTutor and adapted for Nimi in https://github.com/nimiplatform/DeepTutor.
