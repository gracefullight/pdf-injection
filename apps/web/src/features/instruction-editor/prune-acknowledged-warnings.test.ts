import { describe, expect, it } from "bun:test";
import { pruneAcknowledgedWarnings } from "@/features/instruction-editor/prune-acknowledged-warnings";

describe("pruneAcknowledgedWarnings", () => {
  it("keeps only ids that are still present in currentWarningIds", () => {
    expect(
      pruneAcknowledgedWarnings(["fake_citation", "jailbreak_phrasing"], ["jailbreak_phrasing"]),
    ).toEqual(["jailbreak_phrasing"]);
  });

  it("returns the same ids unchanged when every ack is still live", () => {
    expect(pruneAcknowledgedWarnings(["a", "b"], ["a", "b", "c"])).toEqual(["a", "b"]);
  });

  it("clears every acknowledgement when currentWarningIds is empty (unconditional reset)", () => {
    expect(pruneAcknowledgedWarnings(["a", "b"], [])).toEqual([]);
  });

  it("is a no-op on an already-empty acknowledged list", () => {
    expect(pruneAcknowledgedWarnings([], ["a"])).toEqual([]);
  });

  it("does not mistake a same-id re-trigger for a still-valid acknowledgement when reset unconditionally", () => {
    // Simulates: user acknowledges "jailbreak_phrasing" on text A, edits the instruction to text B
    // which independently re-triggers the same warning id. An unconditional reset (empty second
    // arg) is the caller's chosen strategy for "content changed" rather than a partial prune.
    const afterAckOnTextA = pruneAcknowledgedWarnings(["jailbreak_phrasing"], []);
    expect(afterAckOnTextA).toEqual([]);
  });
});
