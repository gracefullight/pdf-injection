import { Database } from "bun:sqlite";
import type { InjectionMode, JobRecord, JobStatus } from "@pdf-injection/contracts";

/**
 * bun:sqlite-backed repository for JobRecord + the internal access-token
 * hash column. Parameterized queries only — no string interpolation into
 * SQL. Instruction text is never a column here (privacy requirement); it
 * only ever exists inside the manifest artifact file on disk.
 */
export interface StoredJobRow extends JobRecord {
  accessTokenHash: string;
  /**
   * Round-2 §1: the variant-set / student-keyed set this job was created
   * from, or null for a plain POST /jobs job. Optional (not required) on
   * `insert()` — `set_id` isn't an insert-time column; it's populated
   * afterward via `setSetId()`, same as today. Always populated (never
   * `undefined`) on every read (`findById`/`findExpired`/`findBySetId`).
   */
  setId?: string | null;
}

interface JobRow {
  id: string;
  status: JobStatus;
  source_filename: string;
  source_sha256: string;
  output_sha256: string | null;
  prompt_sha256: string;
  injection_mode: InjectionMode;
  target_page: number;
  created_at: string;
  expires_at: string;
  error_code: string | null;
  access_token_hash: string;
  set_id: string | null;
}

function rowToRecord(row: JobRow): StoredJobRow {
  return {
    id: row.id,
    status: row.status,
    sourceFilename: row.source_filename,
    sourceSha256: row.source_sha256,
    outputSha256: row.output_sha256,
    promptSha256: row.prompt_sha256,
    injectionMode: row.injection_mode,
    targetPage: row.target_page,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    errorCode: row.error_code,
    accessTokenHash: row.access_token_hash,
    setId: row.set_id ?? null,
  };
}

export class JobsRepository {
  constructor(private readonly db: Database) {}

  migrate(): void {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        source_filename TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        output_sha256 TEXT,
        prompt_sha256 TEXT NOT NULL,
        injection_mode TEXT NOT NULL,
        target_page INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        error_code TEXT,
        access_token_hash TEXT NOT NULL
      );
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_expires_at ON jobs(expires_at);");

    // Round-2 §1: nullable FK linking a job to the variant-set / student-keyed
    // set it was created from (null for jobs created via plain POST /jobs).
    // Guarded ALTER TABLE: SQLite has no "ADD COLUMN IF NOT EXISTS", so check
    // pragma_table_info first (idempotent across repeated migrate() calls).
    const hasSetId =
      (this.db.query("SELECT 1 FROM pragma_table_info('jobs') WHERE name = 'set_id'").get() as {
        1: number;
      } | null) !== null;
    if (!hasSetId) {
      this.db.exec("ALTER TABLE jobs ADD COLUMN set_id TEXT;");
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_set_id ON jobs(set_id);");
  }

  /** Links a job to the variant-set / student-keyed set it was created from (round-2 §1). */
  setSetId(jobId: string, setId: string): void {
    this.db
      .query("UPDATE jobs SET set_id = $setId WHERE id = $id")
      .run({ $setId: setId, $id: jobId });
  }

  /** All member jobs of a variant-set / student-keyed set, in insertion order. */
  findBySetId(setId: string): StoredJobRow[] {
    const rows = this.db
      .query("SELECT * FROM jobs WHERE set_id = ? ORDER BY created_at ASC")
      .all(setId) as JobRow[];
    return rows.map(rowToRecord);
  }

  insert(record: StoredJobRow): void {
    this.db
      .query(
        `INSERT INTO jobs
          (id, status, source_filename, source_sha256, output_sha256, prompt_sha256,
           injection_mode, target_page, created_at, expires_at, error_code, access_token_hash)
         VALUES ($id, $status, $sourceFilename, $sourceSha256, $outputSha256, $promptSha256,
                 $injectionMode, $targetPage, $createdAt, $expiresAt, $errorCode, $accessTokenHash)`,
      )
      .run({
        $id: record.id,
        $status: record.status,
        $sourceFilename: record.sourceFilename,
        $sourceSha256: record.sourceSha256,
        $outputSha256: record.outputSha256,
        $promptSha256: record.promptSha256,
        $injectionMode: record.injectionMode,
        $targetPage: record.targetPage,
        $createdAt: record.createdAt,
        $expiresAt: record.expiresAt,
        $errorCode: record.errorCode,
        $accessTokenHash: record.accessTokenHash,
      });
  }

  findById(id: string): StoredJobRow | null {
    const row = this.db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null;
    return row ? rowToRecord(row) : null;
  }

  updateStatus(
    id: string,
    status: JobStatus,
    outputSha256: string | null,
    errorCode: string | null,
  ): void {
    this.db
      .query(
        "UPDATE jobs SET status = $status, output_sha256 = $outputSha256, error_code = $errorCode WHERE id = $id",
      )
      .run({ $status: status, $outputSha256: outputSha256, $errorCode: errorCode, $id: id });
  }

  delete(id: string): void {
    this.db.query("DELETE FROM jobs WHERE id = ?").run(id);
  }

  findExpired(nowIso: string): StoredJobRow[] {
    const rows = this.db.query("SELECT * FROM jobs WHERE expires_at < ?").all(nowIso) as JobRow[];
    return rows.map(rowToRecord);
  }
}

export function createDatabase(path: string): Database {
  return new Database(path, { create: true });
}
