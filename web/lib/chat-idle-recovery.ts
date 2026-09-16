import { buildResumeTurn } from "@/contracts/parse/turn-command";

interface IdleTurnRecoveryInput {
  isStreaming: boolean;
  hasPendingUserInput: boolean;
  activeTurnId: string | null;
  lastSeq: number;
  updatedAt: number;
  now: number;
  idleTimeoutMs: number;
}

export type IdleTurnRecoveryDecision =
  | { kind: "none" }
  | { kind: "resubscribe"; message: ReturnType<typeof buildResumeTurn> }
  | { kind: "reconcile" };

/**
 * Decide what the client-side idle watchdog should do.
 *
 * A quiet WebSocket is not proof that a server turn failed. Long research
 * tool calls can legitimately emit nothing for several minutes, and the
 * backend keeps the turn alive when a browser briefly disconnects. When a
 * server turn id is known, re-subscribe from the last received sequence so
 * buffered events (including a missed terminal event) are replayed.
 */
export function decideIdleTurnRecovery(
  input: IdleTurnRecoveryInput,
): IdleTurnRecoveryDecision {
  if (!input.isStreaming || input.hasPendingUserInput) return { kind: "none" };
  if (input.now - input.updatedAt <= input.idleTimeoutMs) {
    return { kind: "none" };
  }
  if (!input.activeTurnId) return { kind: "reconcile" };
  return {
    kind: "resubscribe",
    message: buildResumeTurn({
      turnId: input.activeTurnId,
      afterSeq: input.lastSeq,
    }),
  };
}

/**
 * Whether a stored `running` status still describes a live turn.
 *
 * The backend sets a session's status to `running` when a turn starts and
 * clears it when the turn reaches a terminal state. A process that dies
 * mid-turn — a crash, a restart, a killed dev server — never gets to clear
 * it, so the row keeps saying `running` forever. Opening such a session used
 * to put the whole surface into "answering": the composer showed Stop instead
 * of Send, so the learner could not say anything, and nothing was streaming
 * for them to stop. The idle watchdog could not rescue it either, because
 * loading a session stamps `updatedAt` with the load time, which makes a
 * four-day-old turn look freshly active on every tick.
 *
 * A live backend ownership lease takes precedence over timestamps: research
 * can run for minutes while its event prefix is still buffered. Recency only
 * handles stored status for which the backend could not confirm a live owner.
 */
export function resolveLoadedRunStatus<T extends string>(
  status: T,
  lastActivityAt: number,
  now: number,
  idleTimeoutMs: number,
  hasLiveOwner = false,
): T | "idle" {
  if (status !== "running") return status;
  if (hasLiveOwner) return status;
  // No usable timestamp: trust the server rather than guessing.
  if (!Number.isFinite(lastActivityAt) || lastActivityAt <= 0) return status;
  if (now - lastActivityAt <= idleTimeoutMs) return status;
  return "idle";
}
