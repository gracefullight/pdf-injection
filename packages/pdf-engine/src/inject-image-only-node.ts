import {
  type InjectImageOnlyInput,
  type InjectImageOnlyResult,
  injectImageOnlyWith,
} from "./inject-image-only";
import { napiCanvasFactory } from "./native-canvas";

/**
 * `image_only` on the Node/Bun platform: the shared rasterizer
 * (`injectImageOnlyWith`) bound to the `@napi-rs/canvas` surface. Unchanged
 * public API for `apps/api` and the existing tests; the browser binds the same
 * rasterizer to a DOM canvas instead (`inject-image-only-browser.ts`).
 */
export async function injectImageOnly(input: InjectImageOnlyInput): Promise<InjectImageOnlyResult> {
  return injectImageOnlyWith(napiCanvasFactory, input);
}
