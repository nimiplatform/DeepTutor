import type { StreamEvent } from "@/features/chat/model/protocol";
import type { OutlineItem } from "@/lib/research-types";

export type DeepResearchFollowupStatus = "researching" | "done" | "failed";

export function researchFollowupIndices(
  messages: Array<{
    role: string;
    capability?: string;
    events?: StreamEvent[];
  }>,
  parentIndex: number,
): number[] {
  const indices: number[] = [];
  for (let index = parentIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "system") continue;
    if (message.role !== "assistant" || message.capability !== "deep_research")
      break;
    if (
      message.events?.some(
        (event) =>
          event.type === "result" && eventMetadata(event).outline_preview,
      )
    )
      break;
    if (isConfirmedResearchFollowup(message.events)) indices.push(index);
  }
  return indices;
}

function eventMetadata(event: StreamEvent): Record<string, unknown> {
  return (event.metadata ?? {}) as Record<string, unknown>;
}

export function confirmedResearchOutline(
  events: StreamEvent[] | undefined,
): OutlineItem[] | null {
  for (const event of [...(events ?? [])].reverse()) {
    const outline = eventMetadata(event).confirmed_outline;
    if (
      Array.isArray(outline) &&
      outline.length > 0 &&
      outline.every(
        (item) =>
          item &&
          typeof item.title === "string" &&
          typeof item.overview === "string",
      )
    )
      return outline as OutlineItem[];
  }
  return null;
}

export function isConfirmedResearchFollowup(
  events: StreamEvent[] | undefined,
): boolean {
  if (!events?.length) return false;
  if (
    events.some(
      (event) =>
        event.type === "result" &&
        eventMetadata(event).outline_preview === true,
    )
  ) {
    return false;
  }
  return events.some(
    (event) =>
      event.stage === "researching" ||
      event.stage === "reporting" ||
      (event.type === "result" &&
        (eventMetadata(event).metadata as Record<string, unknown> | undefined)
          ?.mode === "agentic_research"),
  );
}

export function researchFollowupStatus(
  events: StreamEvent[] | undefined,
): DeepResearchFollowupStatus {
  const done = [...(events ?? [])]
    .reverse()
    .find((event) => event.type === "done");
  if (!done) return "researching";
  const status = String(eventMetadata(done).status || "completed");
  if (status !== "completed") return "failed";
  const result = [...(events ?? [])]
    .reverse()
    .find((event) => event.type === "result");
  const summary = result
    ? (eventMetadata(result).metadata as Record<string, unknown> | undefined)
    : undefined;
  if (summary?.partial === true) return "failed";
  const response = authoritativeResearchReport(events, "");
  return isStructurallyCompleteResearchReport(response) ? "done" : "failed";
}

function isStructurallyCompleteResearchReport(content: string): boolean {
  const normalized = normalizeDeepResearchReportFormatting(content).trim();
  if (!normalized) return false;
  // A confirmed outline always has at least one researched section, so a
  // complete report needs introduction + one body section + conclusion.
  const numberedSections = normalized.match(/^##\s+\d+\.\s*\S/gm) ?? [];
  if (numberedSections.length < 3) return false;
  if (normalized.endsWith("</details>")) return true;
  return /[.!?。！？)\]）】]$/.test(normalized);
}

export function normalizeDeepResearchReportFormatting(content: string): string {
  if (!content) return content;
  return content.replace(/^(# [^\r\n]*?)(?=##\s+\d+\.\s*)/, "$1\n\n");
}

export function authoritativeResearchReport(
  events: StreamEvent[] | undefined,
  fallback: string,
): string {
  for (let index = (events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = events?.[index];
    if (!event || event.type !== "result") continue;
    const metadata = eventMetadata(event);
    if (metadata.outline_preview === true) continue;
    const response = metadata.response;
    if (typeof response === "string" && response.trim()) {
      return normalizeDeepResearchReportFormatting(response);
    }
  }
  return normalizeDeepResearchReportFormatting(fallback);
}

export function shouldReturnToChatAfterResearch(
  events: StreamEvent[] | undefined,
): boolean {
  if (!isConfirmedResearchFollowup(events)) return false;
  return Boolean(events?.some((event) => event.type === "done"));
}
