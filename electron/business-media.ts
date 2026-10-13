import { randomUUID } from 'node:crypto';
import type { NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';
import type { NimiLocalAppScenarioJobSpec } from '@nimiplatform/sdk';

const CHUNK_BYTES = 512 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const CAPABILITIES = ['text.generate', 'text.embed', 'audio.synthesize', 'audio.transcribe', 'image.generate', 'video.generate'];
const terminal = (status: string) => ['completed', 'failed', 'canceled', 'timeout'].includes(status);
function object(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid media business input.');
  return value as Record<string, any>;
}
function text(value: unknown, optional = false): string {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || (!optional && !value.trim())) throw new Error('Invalid media text input.');
  return value;
}
function requestId(value: unknown): string {
  const id = text(value);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid media submission identity.');
  return id;
}
function jobProjection(job: any) {
  return { ...job, artifacts: job.artifacts.map(({ bytes: _bytes, ...artifact }: any) => artifact) };
}

/** App-owned media calls on the same verified Kit business services as text.
 * Binary chunks stay below the existing pipe frame limit; no provider custody
 * or generic Runtime dispatch is given to the Python business process. */
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-016b
export class DeepTutorBusinessMedia {
  private uploads = new Map<string, { bytes: Buffer; offset: number }>();
  private artifact: { key: string; bytes: Uint8Array; mimeType: string } | undefined;
  clear() { this.uploads.clear(); this.artifact = undefined; }

  async request(operation: string, raw: unknown, services: NimiElectronAppBusinessServices, guard: () => void) {
    if (operation === 'media.config') {
      object(raw, []);
      const snapshot = await services.aiConfig.get();
      guard();
      return { revision: snapshot.revision, selections: snapshot.effectiveSelections
        .filter(row => CAPABILITIES.includes(row.capabilityContract))
        .map(({ capabilityContract, state, reasons }) => ({ capabilityContract, state, reasons })) };
    }
    if (operation === 'media.audio.begin') {
      const input = object(raw, ['sizeBytes']);
      if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_AUDIO_BYTES || this.uploads.size >= 4) throw new Error('Audio upload exceeds the App limit.');
      const id = randomUUID();
      this.uploads.set(id, { bytes: Buffer.alloc(input.sizeBytes), offset: 0 });
      return { id };
    }
    if (operation === 'media.audio.chunk') {
      const input = object(raw, ['id', 'offset', 'bytes']);
      const upload = this.uploads.get(text(input.id));
      const encoded = text(input.bytes);
      const bytes = Buffer.from(encoded, 'base64');
      if (!upload || input.offset !== upload.offset || !bytes.length || bytes.length > CHUNK_BYTES
        || bytes.toString('base64') !== encoded || upload.offset + bytes.length > upload.bytes.length) throw new Error('Invalid audio chunk.');
      bytes.copy(upload.bytes, upload.offset); upload.offset += bytes.length;
      return { offset: upload.offset };
    }
    if (operation === 'media.audio.release') {
      const input = object(raw, ['id']); this.uploads.delete(text(input.id)); return { released: true };
    }
    if (operation === 'media.submit') {
      const input = object(raw, ['requestId', 'type', 'parameters', 'audioId']);
      const id = requestId(input.requestId);
      let spec: NimiLocalAppScenarioJobSpec;
      if (input.type === 'speech-synthesize') {
        const p = object(input.parameters, ['text', 'voice', 'format']);
        const voices = await services.aiConfig.listOptions({ kind: 'preset-voices' });
        guard();
        if (voices.kind !== 'preset-voices') throw new Error('Nimi returned an unexpected voice list.');
        if ((voices.options.length > 0 || p.voice) && !voices.options.some(voice => voice.voiceId === p.voice)) {
          throw new Error('Choose a voice for the selected model in Settings > Text-to-Speech.');
        }
        spec = { type: 'speech-synthesize', text: text(p.text), language: '', audioFormat: text(p.format, true),
          emotion: '', voiceRef: p.voice ? { type: 'preset', id: text(p.voice) } : null, timingMode: 'none', voiceRenderHints: null };
      } else if (input.type === 'speech-transcribe') {
        const p = object(input.parameters, ['mimeType', 'language', 'timestamps']);
        const upload = this.uploads.get(text(input.audioId));
        if (!upload || upload.offset !== upload.bytes.length || typeof p.timestamps !== 'boolean') throw new Error('Incomplete transcription input.');
        spec = { type: 'speech-transcribe', mimeType: text(p.mimeType), language: text(p.language, true), timestamps: p.timestamps,
          prompt: '', responseFormat: '', audioSource: { type: 'bytes', bytes: upload.bytes } };
        this.uploads.delete(input.audioId);
      } else if (input.type === 'image-generate') {
        const p = object(input.parameters, ['prompt', 'size', 'quality', 'style', 'n']);
        if (!Number.isInteger(p.n) || p.n < 1 || p.n > 4) throw new Error('Invalid image count.');
        spec = { type: 'image-generate', prompt: text(p.prompt), n: p.n, size: text(p.size, true), quality: text(p.quality, true), style: text(p.style, true),
          negativePrompt: '', aspectRatio: '', referenceImages: [], referenceImageArtifactId: '', mask: '', responseFormat: '' };
      } else if (input.type === 'video-generate') {
        const p = object(input.parameters, ['prompt', 'ratio', 'durationSec', 'resolution']);
        if (p.durationSec !== undefined && (!Number.isFinite(p.durationSec) || p.durationSec <= 0)) throw new Error('Invalid video duration.');
        const prompt = text(p.prompt);
        spec = { type: 'video-generate', prompt, negativePrompt: '', mode: 't2v', content: [{ type: 'text', role: 'prompt', text: prompt }],
          options: { ratio: text(p.ratio, true), resolution: text(p.resolution, true), ...(p.durationSec === undefined ? {} : { durationSec: p.durationSec }) } };
      } else throw new Error('Unsupported media task.');
      const result = await services.ai.scenarioJobs.submit(spec, { clientSubmissionId: id });
      guard(); return jobProjection(result.job);
    }
    if (operation === 'media.lookup') {
      const input = object(raw, ['requestId']);
      const result = await services.ai.scenarioJobs.lookupSubmission(requestId(input.requestId));
      guard(); return jobProjection(result.job);
    }
    if (operation === 'media.get' || operation === 'media.cancel') {
      const input = object(raw, ['jobId']);
      const id = text(input.jobId);
      const result = operation === 'media.get' ? await services.ai.scenarioJobs.get(id)
        : await services.ai.scenarioJobs.cancel(id, 'DeepTutor user stopped the media task');
      guard(); return jobProjection(result.job);
    }
    if (operation === 'media.artifact') {
      const input = object(raw, ['jobId', 'artifactId', 'offset']);
      const key = text(input.jobId) + ':' + text(input.artifactId);
      if (!Number.isSafeInteger(input.offset) || input.offset < 0) throw new Error('Invalid artifact offset.');
      if (this.artifact?.key !== key) {
        const { job } = await services.ai.scenarioJobs.get(input.jobId); guard();
        if (!terminal(job.status) || job.status !== 'completed' || !job.artifacts.some(a => a.artifactId === input.artifactId)) throw new Error('Media artifact is not a completed result.');
        const artifact = await services.ai.artifacts.read(input.artifactId); guard();
        this.artifact = { key, bytes: artifact.bytes, mimeType: artifact.mimeType };
      }
      const artifact = this.artifact;
      if (input.offset >= artifact.bytes.length) throw new Error('Artifact offset exceeds the result.');
      const bytes = artifact.bytes.subarray(input.offset, input.offset + CHUNK_BYTES);
      const result = { bytes: Buffer.from(bytes).toString('base64'), sizeBytes: artifact.bytes.length, mimeType: artifact.mimeType, offset: input.offset };
      if (input.offset + bytes.length === artifact.bytes.length) this.artifact = undefined;
      return result;
    }
    throw new Error('Unsupported DeepTutor media operation.');
  }
}
