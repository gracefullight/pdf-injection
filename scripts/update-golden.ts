#!/usr/bin/env bun
/**
 * Regenerates every golden file under tests/golden/ (PRD §22.3).
 *
 * Run with `bun run golden:update`. Deterministic: re-running with unchanged
 * pdf-engine/validation behavior produces byte-identical output except the
 * `generatedAt` timestamp (verified by golden.test.ts's generator-determinism
 * suite, which calls the same builders directly). Safe to re-run any number
 * of times (idempotent) — it always overwrites the full set from the fixture
 * lists in tests/golden/golden-lib.ts, never partially.
 *
 * Byte equality of the injected PDFs is intentionally NOT part of what's
 * recorded (PRD §22.3) — see golden-lib.ts's GoldenInjectCase doc comment.
 */
import path from "node:path";
import {
  buildInjectCase,
  buildNegativeCase,
  GOLDEN_DIR,
  goldenFileName,
  KO_FIXTURES,
  KO_MODES,
  MODES,
  NEGATIVE_FIXTURES,
  negativeGoldenFileName,
  POSITIVE_FIXTURES,
  resolveToolVersions,
  stableStringify,
} from "../tests/golden/golden-lib";

async function writeGolden(fileName: string, goldenCase: unknown): Promise<void> {
  await Bun.write(path.join(GOLDEN_DIR, fileName), stableStringify(goldenCase));
}

async function main(): Promise<void> {
  const toolVersions = await resolveToolVersions();
  let written = 0;

  for (const fixture of POSITIVE_FIXTURES) {
    for (const mode of MODES) {
      const goldenCase = await buildInjectCase(fixture, mode, "en", toolVersions);
      const fileName = goldenFileName(fixture, mode, "en");
      await writeGolden(fileName, goldenCase);
      console.log(`wrote tests/golden/${fileName}`);
      written++;
    }
  }

  for (const fixture of KO_FIXTURES) {
    for (const mode of KO_MODES) {
      const goldenCase = await buildInjectCase(fixture, mode, "ko", toolVersions);
      const fileName = goldenFileName(fixture, mode, "ko");
      await writeGolden(fileName, goldenCase);
      console.log(`wrote tests/golden/${fileName}`);
      written++;
    }
  }

  for (const { fixture, expectedErrorCode } of NEGATIVE_FIXTURES) {
    const goldenCase = await buildNegativeCase(fixture, expectedErrorCode, toolVersions);
    const fileName = negativeGoldenFileName(fixture);
    await writeGolden(fileName, goldenCase);
    console.log(`wrote tests/golden/${fileName}`);
    written++;
  }

  console.log(`\nWrote ${written} golden files to tests/golden/`);
}

await main();
