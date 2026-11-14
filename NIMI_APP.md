# DeepTutor on Nimi

Study documents, ask questions and keep learning notes in the original DeepTutor workspace. Nimi supplies the account session, App authorization and AI resources.

## Start learning

1. Open DeepTutor from Nimi Home and keep Nimi running.
2. Open **Nimi models** in chat. Select the text model used for learning tasks; document indexing also requires a text-embedding model.
3. Start a chat, or add and index study materials in **Knowledge Center** before asking questions about them.
4. Save useful results to a notebook or export the chat as Markdown.

Choose a model that supports the controls required by the current task. A rejected model request is shown as a failure; the App does not silently replace the configured resource. Changing the embedding model requires re-indexing materials.

## From a browser

When your App provider supplies a Web address, sign in through the official Nimi page and confirm the source in Home on your PC. Keep the original DeepTutor App and PC running, and allow its learning-workspace Integration in Home. Your learning tasks and saved materials continue to belong to that PC workspace.

Web model settings show the PC configuration; change models, service connections and machine folders in the native App. If DeepTutor's own multi-user mode is enabled, its business login still applies separately. Reloading the Web entry requires official sign-in again. Reconnection observes saved tasks; it does not resubmit earlier learning work automatically.

Learning sessions, source files, indexes, notebooks and App settings are stored in the PC workspace prepared by Nimi for its Host. Web downloads are saved on the browser device, while browser drafts belong to that browser and account/workspace partition. The upstream About badge identifies the upstream DeepTutor version; Nimi Home identifies the Nimi App package version.

## Android development preview

The local Android test App connects to the same PC workspace and needs both the PC App and its configured local Web service to stay running. Sign in in the system browser, return to DeepTutor, then connect and approve its separate Android source and workspace access in Nimi Home. You can reopen saved conversations, save their Markdown through Android's system picker and attach selected files. A new learning question using the existing PC text model, followed by reconnecting and reading its saved answer, has also been verified on Android. This preview is not an offline App; microphone capture and generated-media playback remain unverified.

When a system file picker interrupts the Runtime connection, selected files, unsubmitted chat input and selected chat-history references stay in memory. Reconnect, reopen **Add files → Attach files**, and choose **Use selected files**. Review the attachment before sending; selecting a file does not send a learning question. Exported learning files use Android's system Save picker; keep the App open until the outer page reports the result. If Android adds a suffix to preserve an existing file, the saved result shows the actual name. A full App restart clears unsubmitted device input and selected files; saved learning records remain on the PC. Microphone use requires the normal system permission.

DeepTutor retains its Apache-2.0 license. Product details and development notes are available in the [adaptation repository](https://github.com/nimiplatform/DeepTutor).
