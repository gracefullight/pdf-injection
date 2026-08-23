# PDF.js standard font warning fix

Symptom: server-side PDF text extraction emitted `Ensure that the standardFontDataUrl API parameter is provided` for standard-font PDFs.

Root cause: `packages/validation/src/text-extract.ts` and `apps/api/src/lib/pdf-text.ts` passed `disableFontFace: true` to `pdfjsLib.getDocument()` without `standardFontDataUrl`.

Fix: resolve `pdfjs-dist/package.json`, derive its bundled `standard_fonts/` directory, and pass it to both production loaders. Regression tests capture PDF.js console output and assert the warning is absent.

Verification: focused tests 10/10; related validation/API tests 55/55; both scoped typechecks and Biome check passed. Bug report: `.agents/results/bugs/bug-20260823-pdfjs-standard-font-warning.md`.

Similar scan: metadata-only loader does not emit the warning; browser loader uses a different asset model; one capability-gated OCR test helper still omits the option but is outside production.