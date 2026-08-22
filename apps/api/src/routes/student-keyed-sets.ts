import { Elysia } from "elysia";
import type { AppConfig } from "../config";
import { ApiError } from "../errors";
import { readFormData, strField } from "../lib/multipart";
import { requireSet } from "../lib/set-token";
import { securityHeaders } from "../middleware/security-headers";
import type { JobsRepository } from "../repositories/jobs.repository";
import type { VariantSetsRepository } from "../repositories/variant-sets.repository";
import {
  buildStudentKeyedSetArchive,
  createStudentKeyedSet,
  deleteStudentKeyedSet,
  getMappingCsv,
  getStudentKeyedSet,
} from "../services/student-keyed-set.service";

const MULTIPART_OVERHEAD_BYTES = 262_144; // 256 KiB (studentIds[] JSON can be large — up to 500 ids)

export interface StudentKeyedSetsRouteDeps {
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

export function studentKeyedSetsRoutes(deps: StudentKeyedSetsRouteDeps) {
  const { config } = deps;

  return new Elysia()
    .post("/api/v1/student-keyed-sets", async ({ request, set }) => {
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
      const instructionTemplate = strField(formData, "instructionTemplate");
      if (instructionTemplate === null) {
        throw new ApiError("VALIDATION_ERROR", "instructionTemplate field is required");
      }
      const expectedSignalsJson = strField(formData, "expectedSignals");
      if (expectedSignalsJson === null) {
        throw new ApiError("VALIDATION_ERROR", "expectedSignals field is required");
      }
      const studentIdsJson = strField(formData, "studentIds");
      if (studentIdsJson === null) {
        throw new ApiError("VALIDATION_ERROR", "studentIds field is required");
      }
      const injectionMode = strField(formData, "injectionMode");
      if (injectionMode === null) {
        throw new ApiError("VALIDATION_ERROR", "injectionMode field is required");
      }

      const result = await createStudentKeyedSet(deps, {
        file,
        instructionTemplate,
        expectedSignalsJson,
        studentIdsJson,
        keyLengthRaw: strField(formData, "keyLength"),
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
    .get("/api/v1/student-keyed-sets/:id", async ({ params, headers }) => {
      requireSet(deps.variantSetsRepo, params.id, "student_keyed", headers["x-job-token"]);
      return getStudentKeyedSet(deps, params.id);
    })
    .get("/api/v1/student-keyed-sets/:id/mapping", async ({ params, headers }) => {
      requireSet(deps.variantSetsRepo, params.id, "student_keyed", headers["x-job-token"]);
      // PRIVATE, csv-only (per contract §1: "studentId,key,jobId,outputSha256").
      const csv = await getMappingCsv(deps, params.id);
      return csvResponse(csv, `student-keyed-set.${params.id}.mapping.csv`);
    })
    .get("/api/v1/student-keyed-sets/:id/archive", async ({ params, headers }) => {
      requireSet(deps.variantSetsRepo, params.id, "student_keyed", headers["x-job-token"]);
      const bytes = await buildStudentKeyedSetArchive(deps, params.id);
      return zipResponse(bytes, `student-keyed-set.${params.id}.zip`);
    })
    .delete("/api/v1/student-keyed-sets/:id", async ({ params, headers }) => {
      requireSet(deps.variantSetsRepo, params.id, "student_keyed", headers["x-job-token"]);
      await deleteStudentKeyedSet(deps, params.id);
      return withHeaders(new Response(null, { status: 204 }));
    });
}
