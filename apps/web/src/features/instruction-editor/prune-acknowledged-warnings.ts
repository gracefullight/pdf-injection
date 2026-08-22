/**
 * Filters a list of acknowledged lint-warning ids down to the ones present in
 * `currentWarningIds`. Passing an empty `currentWarningIds` array clears every
 * acknowledgement — used by callers that want an unconditional reset (e.g.
 * "the instruction or expected signals changed, so every prior acknowledgement
 * is stale and must be re-confirmed") rather than a partial prune.
 *
 * Guards against `LintIssue.id` being a fixed, content-independent string
 * (e.g. "jailbreak_phrasing"): without this, acknowledging a warning once and
 * then editing the instruction so the *same warning id* re-triggers on
 * materially different text would leave the checkbox pre-checked and
 * `canContinue` silently true, without a fresh acknowledgement of the new text.
 */
export function pruneAcknowledgedWarnings(
  acknowledged: string[],
  currentWarningIds: string[],
): string[] {
  if (currentWarningIds.length === 0) return [];
  const liveIds = new Set(currentWarningIds);
  return acknowledged.filter((id) => liveIds.has(id));
}
