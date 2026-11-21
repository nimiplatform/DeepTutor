# DeepTutor on Nimi

DeepTutor is a local-first AI learning workspace for studying documents, working through complex derivations, organizing structured notes, and planning study tasks on your PC. Nimi supplies account sign-in, App authorization, and AI model access.

## What you can do

- **Knowledge Center & Grounded Q&A**: Import PDFs, Markdown, and study documents into local Knowledge Bases, index them with Nimi embeddings, and ask grounded questions with source citations and inline document preview.
- **Deep Solve & Learning Workflows**: Work through math, science, and engineering problems step by step with rendered LaTeX equations, deep research stages, and visual explanations.
- **Notebooks & Co-Writer**: Save answers and derivations into organized Notebooks, draft structured reports in Co-Writer, track study goals on the Task Board, and export conversations or notes as Markdown.
- **Optional Multimodal Tools**: Use Nimi-configured read-aloud speech, microphone transcription, and image or video generation inside your learning workspace.

## Start learning on PC

1. Open DeepTutor from **Nimi Home** on Windows (x64) or macOS (Apple Silicon) and keep Nimi running.
2. Open **Nimi models** in chat or **Settings → Models & services** and configure the models you want to use:
   - **Text model (`text.generate`)**: required for chat, problem solving, research, and writing.
   - **Embedding model (`text.embed`)**: required for Knowledge Center document indexing and grounded retrieval.
   - **Optional media models**: `audio.synthesize` (read-aloud), `audio.transcribe` (microphone input), `image.generate`, and `video.generate`.
3. Start a conversation directly, or upload and index study materials in **Knowledge Center** before asking grounded questions with citations.
4. Save key explanations to **Notebooks**, refine longer write-ups in **Co-Writer**, organize follow-up tasks on the **Task Board**, or export as Markdown.

## PC and model behavior

- DeepTutor runs natively on your PC and uses the Local or Cloud models you configure in Nimi.
- Choose a model that supports the controls required by your current task. Rejected model requests are shown directly as errors; DeepTutor does not silently switch to another model.
- After changing your embedding model, re-index existing Knowledge Bases before running retrieval queries.

## Data handling and limitations

- **Local PC custody**: Conversations, uploaded documents, vector indexes, notebooks, Co-Writer drafts, reading workspaces, tasks, calendar items, and App settings stay on your PC inside `<Nimi data root>/app-hosts/*/apps/*/user-data/workspace/**`. Uninstalling the App package in Nimi removes only the managed executable package and leaves that workspace folder untouched until you delete it yourself.
- **Model data flow**: Local Nimi routes keep inference on your machine. When using a Cloud model route configured in Nimi, only the prompt, retrieved excerpts, or attachments needed for that turn are sent to your chosen provider.
- **Version display**: The in-App About badge reflects the upstream DeepTutor core version (`1.7.4`), while Nimi Home displays the Nimi App package version (`1.6.20`).
- **Optional external tools**: Web search providers, optional local CLI subagents, and Manim/FFmpeg rendering remain user-configured on your PC and are unavailable until set up there.
- **Browser remote access status**: DeepTutor `1.6.20` prepares the PC workspace provider (`deeptutor.workspace.v3`) for future remote browser access, but hosted Web access is not yet publicly published as part of this native package release. Once hosted Web is separately released and admitted, it will require DeepTutor `1.6.20` or later running in Nimi Home on your PC under the same account, along with source confirmation and Integration approval in Nimi Home.

## Help and license

DeepTutor is licensed under Apache-2.0, based on upstream [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) and adapted for Nimi in [nimiplatform/DeepTutor](https://github.com/nimiplatform/DeepTutor). Report issues and feedback at [GitHub Issues](https://github.com/nimiplatform/DeepTutor/issues).
