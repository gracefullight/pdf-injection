// PRD §22.3: golden tests. Re-runs injectPdf/extractText/checkMetadataPayload
// against every committed tests/golden/<fixture>.<mode>[.ko].json (and
// inspectSource() against the negative-fixture goldens) and asserts the
// current behavior still matches what was recorded. Byte equality is
// intentionally NOT asserted (see golden-lib.ts).
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { diffThreshold, type InjectionMode, type PayloadLanguage } from "@pdf-injection/contracts";
import { injectPdf, inspectSource } from "@pdf-injection/pdf-engine";
import { checkMetadataPayload, extractText } from "@pdf-injection/validation";
import {
  buildInjectCase,
  buildNegativeCase,
  EN_INSTRUCTION,
  FIXTURES_DIR,
  GOLDEN_DIR,
  type GoldenInjectCase,
  type GoldenNegativeCase,
  goldenFileName,
  KO_FIXTURES,
  KO_INSTRUCTION,
  KO_MODES,
  MODES,
  NEGATIVE_FIXTURES,
  negativeGoldenFileName,
  POSITIVE_FIXTURES,
  parseDiffRatio,
  resolveToolVersions,
  withoutGeneratedAt,
} from "./golden-lib";

const GOLDEN_UPDATE_HINT =
  "Golden mismatch. If this is an intentional behavior change, run `bun run golden:update`, review the diff in tests/golden/, and commit it.";

async function readGolden<T>(fileName: string): Promise<T> {
  const file = Bun.file(path.join(GOLDEN_DIR, fileName));
  if (!(await file.exists())) {
    throw new Error(`Missing golden file tests/golden/${fileName}. ${GOLDEN_UPDATE_HINT}`);
  }
  return (await file.json()) as T;
}

async function assertMatchesInjectGolden(
  fixture: string,
  mode: InjectionMode,
  payloadLanguage: PayloadLanguage,
  golden: GoldenInjectCase,
): Promise<void> {
  const source = await Bun.file(path.join(FIXTURES_DIR, fixture)).bytes();
  const instruction = payloadLanguage === "ko" ? KO_INSTRUCTION : EN_INSTRUCTION;

  const result = await injectPdf({
    source: new Uint8Array(source),
    instruction,
    mode,
    targetPage: "last",
    position: "bottom",
    payloadLanguage,
  });

  expect(result.pageGeometryAfter.length, GOLDEN_UPDATE_HINT).toBe(golden.expectedPageCount);
  expect(result.pageGeometryAfter, GOLDEN_UPDATE_HINT).toEqual(golden.expectedGeometry);
  expect(diffThreshold(mode), GOLDEN_UPDATE_HINT).toBe(parseDiffRatio(golden.maxVisualDiffRatio));

  const extraction = await extractText({
    bytes: result.bytes,
    targetInstruction: instruction,
    targetPageIndex: result.pageIndex,
  });
  expect(extraction.targetPageMatch, GOLDEN_UPDATE_HINT).toBe(
    golden.expectedExtraction.hiddenTextExtracted,
  );
  expect(extraction.targetPageMatch, GOLDEN_UPDATE_HINT).toBe(
    golden.expectedExtraction.targetPageMatch,
  );

  if (mode === "xmp_only") {
    const metadata = await checkMetadataPayload(result.bytes, instruction);
    const expectedMetadataPayloadPresent = golden.expectedExtraction.metadataPayloadPresent;
    expect(
      expectedMetadataPayloadPresent,
      `${GOLDEN_UPDATE_HINT} (xmp_only golden must record a non-null metadataPayloadPresent)`,
    ).not.toBeNull();
    expect(metadata.payloadFound, GOLDEN_UPDATE_HINT).toBe(
      expectedMetadataPayloadPresent as boolean,
    );
  } else {
    expect(golden.expectedExtraction.metadataPayloadPresent, GOLDEN_UPDATE_HINT).toBeNull();
  }

  // Exact-set comparison (sorted, deduped): a warning silently disappearing
  // OR a new, unrecorded warning appearing both fail the golden. Matches how
  // golden-lib.ts's buildInjectCase records expectedWarnings
  // ([...new Set(codes)].sort()), so this is a like-for-like comparison.
  const actualWarningCodes = [...new Set(result.warnings.map((w) => w.code))].sort();
  expect(actualWarningCodes, GOLDEN_UPDATE_HINT).toEqual(golden.expectedWarnings);
}

describe("golden: inject fixtures (payloadLanguage en)", () => {
  for (const fixture of POSITIVE_FIXTURES) {
    for (const mode of MODES) {
      test(`${fixture} x ${mode} (en) matches golden`, async () => {
        const golden = await readGolden<GoldenInjectCase>(goldenFileName(fixture, mode, "en"));
        await assertMatchesInjectGolden(fixture, mode, "en", golden);
      }, 15_000);
    }
  }
});

describe("golden: inject fixtures (payloadLanguage ko)", () => {
  for (const fixture of KO_FIXTURES) {
    for (const mode of KO_MODES) {
      test(`${fixture} x ${mode} (ko) matches golden`, async () => {
        const golden = await readGolden<GoldenInjectCase>(goldenFileName(fixture, mode, "ko"));
        await assertMatchesInjectGolden(fixture, mode, "ko", golden);
      });
    }
  }
});

describe("golden: negative fixtures (inspectSource rejection)", () => {
  for (const { fixture } of NEGATIVE_FIXTURES) {
    test(`${fixture} matches golden rejection code`, async () => {
      const golden = await readGolden<GoldenNegativeCase>(negativeGoldenFileName(fixture));
      const bytes = await Bun.file(path.join(FIXTURES_DIR, fixture)).bytes();

      let actualCode: string | null = null;
      try {
        await inspectSource({ bytes: new Uint8Array(bytes), filename: fixture });
      } catch (err) {
        actualCode = (err as { code?: string }).code ?? null;
      }

      expect(actualCode, GOLDEN_UPDATE_HINT).toBe(golden.expectedErrorCode);
    });
  }
});

describe("golden: generator determinism (scripts/update-golden.ts idempotency)", () => {
  test("buildInjectCase produces identical output (except generatedAt) across two runs", async () => {
    const toolVersions = await resolveToolVersions();
    const first = await buildInjectCase("one-page-text.pdf", "white_text", "en", toolVersions);
    const second = await buildInjectCase("one-page-text.pdf", "white_text", "en", toolVersions);
    expect(withoutGeneratedAt(second)).toEqual(withoutGeneratedAt(first));
  });

  test("buildInjectCase(xmp_only) produces identical output (except generatedAt) across two runs", async () => {
    const toolVersions = await resolveToolVersions();
    const first = await buildInjectCase("annotations.pdf", "xmp_only", "en", toolVersions);
    const second = await buildInjectCase("annotations.pdf", "xmp_only", "en", toolVersions);
    expect(withoutGeneratedAt(second)).toEqual(withoutGeneratedAt(first));
  });

  test("buildNegativeCase produces identical output (except generatedAt) across two runs", async () => {
    const toolVersions = await resolveToolVersions();
    const first = await buildNegativeCase("encrypted.pdf", "PDF_ENCRYPTED", toolVersions);
    const second = await buildNegativeCase("encrypted.pdf", "PDF_ENCRYPTED", toolVersions);
    expect(withoutGeneratedAt(second)).toEqual(withoutGeneratedAt(first));
  });
});

describe("golden: coverage", () => {
  test("every POSITIVE_FIXTURES x MODES combination has a committed golden file", async () => {
    for (const fixture of POSITIVE_FIXTURES) {
      for (const mode of MODES) {
        const file = Bun.file(path.join(GOLDEN_DIR, goldenFileName(fixture, mode, "en")));
        expect(
          await file.exists(),
          `missing tests/golden/${goldenFileName(fixture, mode, "en")}`,
        ).toBe(true);
      }
    }
  });

  test("every KO_FIXTURES x KO_MODES combination has a committed golden file", async () => {
    for (const fixture of KO_FIXTURES) {
      for (const mode of KO_MODES) {
        const file = Bun.file(path.join(GOLDEN_DIR, goldenFileName(fixture, mode, "ko")));
        expect(
          await file.exists(),
          `missing tests/golden/${goldenFileName(fixture, mode, "ko")}`,
        ).toBe(true);
      }
    }
  });

  test("every NEGATIVE_FIXTURES entry has a committed golden file", async () => {
    for (const { fixture } of NEGATIVE_FIXTURES) {
      const file = Bun.file(path.join(GOLDEN_DIR, negativeGoldenFileName(fixture)));
      expect(await file.exists(), `missing tests/golden/${negativeGoldenFileName(fixture)}`).toBe(
        true,
      );
    }
  });
});
