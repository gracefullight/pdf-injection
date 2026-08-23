/**
 * Browser-safe surface of `@pdf-injection/pdf-engine`.
 *
 * Import this (`@pdf-injection/pdf-engine/browser`) — never the package root —
 * from `apps/web`. The root barrel re-exports `korean-font.ts` (`node:fs`),
 * `native-canvas.ts` (`node:module`) and `pdf-standard-security.ts`
 * (`Bun.CryptoHasher`), so pulling it into a browser bundle would drag Node
 * built-ins into the module graph. Everything re-exported here is pure
 * `pdf-lib` + `@pdf-injection/contracts`, verified by
 * `test/browser-entry-purity.test.ts`.
 */
export * from "./browser-entry-modules";
