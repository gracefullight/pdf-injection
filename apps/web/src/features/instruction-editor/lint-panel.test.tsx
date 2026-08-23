import { describe, expect, it } from "bun:test";
import type { LintIssue } from "@pdf-injection/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { LintPanel } from "@/features/instruction-editor/lint-panel";

function renderLintPanel(errors: LintIssue[]): string {
  return renderToStaticMarkup(
    <LintPanel errors={errors} warnings={[]} acknowledged={[]} onAcknowledgedChange={() => {}} />,
  );
}

describe("LintPanel field validation", () => {
  it("leaves an empty signal value to the inline signal editor instead of a top-level alert", () => {
    const html = renderLintPanel([
      {
        id: "empty_signal_value",
        severity: "error",
        message: "Every expected signal needs a value — fill in or remove empty ones.",
      },
    ]);

    expect(html).toBe("");
  });

  it("still renders non-field lint errors as destructive alerts", () => {
    const html = renderLintPanel([
      { id: "prompt_too_long", severity: "error", message: "Prompt is too long." },
    ]);

    expect(html).toContain('data-testid="lint-error-prompt_too_long"');
    expect(html).toContain("Fix required");
  });
});
