import { describe, expect, it } from "bun:test";
import type { ExpectedSignal } from "@pdf-injection/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { SignalBuilder } from "@/features/instruction-editor/signal-builder";

function renderSignal(signal: ExpectedSignal): string {
  return renderToStaticMarkup(<SignalBuilder signals={[signal]} onChange={() => {}} />);
}

describe("SignalBuilder inline validation", () => {
  it("marks an empty exact phrase at the field that needs attention", () => {
    const html = renderSignal({ type: "exact_phrase", value: "", caseSensitive: false });

    expect(html).toContain('data-testid="signal-row-error-0"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="signal-row-error-0"');
    expect(html).toContain("Enter a phrase or remove this signal.");
  });

  it("does not show an inline error for a complete signal", () => {
    const html = renderSignal({ type: "exact_phrase", value: "Method C", caseSensitive: false });

    expect(html).not.toContain("signal-row-error-0");
    expect(html).not.toContain('aria-invalid="true"');
  });
});
