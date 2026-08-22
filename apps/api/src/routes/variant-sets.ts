import { isDistributionRequest } from "@pdf-injection/contracts";
import { Elysia } from "elysia";
import type { AppConfig } from "../config";
import { ApiError } from "../errors";
import { readFormData, strField } from "../lib/multipart";
import { requireSet } from "../lib/set-token";
import { securityHeaders } from "../middleware/security-headers";
import type { JobsRepository } from "../repositories/jobs.repository";
import type { VariantSetsRepository } from "../repositories/variant-sets.repository";
import {
  buildDistribution,
  buildVariantSetArchive,
  createVariantSet,
  deleteVariantSet,
  distributionToCsv,
  getDistribution,
  getVariantSet,
} from "../services/variant-set.service";

// Slack allowance beyond the max PDF file size for the other multipart fields.
const MULTIPART_OVERHEAD_BYTES = 262_144; // 256 KiB (variants[] JSON can be larger than a single job's fields)

export interface VariantSetsRouteDeps {
  config: AppConfig;
  jobsRepo: JobsRepository;
  variantSetsRepo: VariantSetsRepository;
}

function withHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(securityHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

function csvResponse(body: string, filename: string): Response {
  return withHeaders(
    new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    }),
  );
}

function zipResponse(bytes: Uint8Array, filename: string): Response {
  return withHeaders(
    new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    }),
  );
}

export function variantSetsRoutes(deps: VariantSetsRouteDeps) {
  const { config } = deps;

  return new Elysia()
    .post("/api/v1/variant-sets", async ({ request, set }) => {
      const maxBytesWithOverhead = config.maxFileBytes + MULTIPART_OVERHEAD_BYTES;
      const contentLength = Number(request.headers.get("content-length") ?? 0);
      if (contentLength > maxBytesWithOverhead) {
        throw new ApiError("FILE_TOO_LARGE");
      }
      const formData = await readFormData(request, maxBytesWithOverhead);

      const file = formData.get("file");
      if (!(file instanceof File)) {
        throw new ApiError("VALIDATION_ERROR", "file field is required and must be a PDF file");
      }
      const variantsJson = strField(formData, "variants");
      if (variantsJson === null) {
        throw new ApiError("VALIDATION_ERROR", "variants field is required");
      }
      const injectionMode = strField(formData, "injectionMode");
      if (injectionMode === null) {
        throw new ApiError("VALIDATION_ERROR", "injectionMode field is required");
      }

      const result = await createVariantSet(deps, {
        file,
        variantsJson,
        injectionMode,
        targetPageRaw: strField(formData, "targetPage"),
        positionRaw: strField(formData, "position"),
        xRaw: strField(formData, "x"),
        yRaw: strField(formData, "y"),
        fontSizeRaw: strField(formData, "fontSize"),
        maxWidthRaw: strField(formData, "maxWidth"),
        payloadLanguageRaw: strField(formData, "payloadLanguage"),
        acknowledgedWarningsRaw: strField(formData, "acknowledgedWarnings"),
      });
      set.status = 201;
      return result;
    })
    .get("/api/v1/variant-sets/:id", async ({ params, headers }) => {
      requireSet(deps.variantSetsRepo, params.id, "variant", headers["x-job-token"]);
      return getVariantSet(deps, params.id);
    })
    .post("/api/v1/variant-sets/:id/distribution", async ({ params, headers, request }) => {
      requireSet(deps.variantSetsRepo, params.id, "variant", headers["x-job-token"]);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new ApiError("VALIDATION_ERROR", "Request body must be valid JSON");
      }
      if (!isDistributionRequest(body)) {
        throw new ApiError("VALIDATION_ERROR", "Request body does not match DistributionRequest");
      }
      return buildDistribution(deps, params.id, body.studentIds, body.strategy, body.seed);
    })
    .get("/api/v1/variant-sets/:id/distribution", async ({ params, headers, query }) => {
      requireSet(deps.variantSetsRepo, params.id, "variant", headers["x-job-token"]);
      const distribution = await getDistribution(deps, params.id);
      if (query.format === "csv") {
        return csvResponse(
          distributionToCsv(distribution),
          `variant-set.${params.id}.distribution.csv`,
        );
      }
      return distribution;
    })
    .get("/api/v1/variant-sets/:id/archive", async ({ params, headers }) => {
      requireSet(deps.variantSetsRepo, params.id, "variant", headers["x-job-token"]);
      const bytes = await buildVariantSetArchive(deps, params.id);
      return zipResponse(bytes, `variant-set.${params.id}.zip`);
    })
    .delete("/api/v1/variant-sets/:id", async ({ params, headers }) => {
      requireSet(deps.variantSetsRepo, params.id, "variant", headers["x-job-token"]);
      await deleteVariantSet(deps, params.id);
      return withHeaders(new Response(null, { status: 204 }));
    });
}
