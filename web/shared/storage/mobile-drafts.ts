// Unsubmitted input only. The identity frame owns this memory; it is not a task journal.
let values: Record<string, unknown> = {};
let send: ((key: string, value: unknown) => void) | undefined;
export function bindMobileDrafts(initial: Record<string, unknown>, write: (key: string, value: unknown) => void) {
  values = initial; send = write;
}
export function endMobileDrafts() { send = undefined; values = {}; }
export function readMobileDraft<T>(key: string): T | undefined { return values[key] as T | undefined; }
export function writeMobileDraft(key: string, value: unknown) {
  if (!send) return;
  values[key] = value; send(key, value);
}
export const isMobileWorkspace = () => Boolean(send);
