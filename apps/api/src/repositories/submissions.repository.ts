import type { Database } from "bun:sqlite";
import type {
  SubmissionAnalysis,
  SubmissionLabel,
  SubmissionSource,
} from "@pdf-injection/contracts";

/**
 * bun:sqlite-backed repository for round-2 §3 submissions. `analysis_json`
 * stores the full `SubmissionAnalysis` (signals/scores/calibration/
 * interpretation) computed at request time — `calibration.pValue` /
 * `holmAdjustedPValue` are recomputed against the job's current baseline
 * set on every list/get (see submission.service.ts) and written back here
 * so the persisted row always reflects the latest batch. The raw
 * submission text lives only in `<jobDir>/submissions/<id>.txt` on disk,
 * never in this table (never logged either).
 */
export interface SubmissionRow {
  id: string;
  jobId: string;
  label: SubmissionLabel;
  createdAt: string;
  textSha256: string;
  textLength: number;
  source: SubmissionSource;
  analysisJson: string;
}

interface DbRow {
  id: string;
  job_id: string;
  label: SubmissionLabel;
  created_at: string;
  text_sha256: string;
  text_length: number;
  source: SubmissionSource;
  analysis_json: string;
}

function rowToRecord(row: DbRow): SubmissionRow {
  return {
    id: row.id,
    jobId: row.job_id,
    label: row.label,
    createdAt: row.created_at,
    textSha256: row.text_sha256,
    textLength: row.text_length,
    source: row.source,
    analysisJson: row.analysis_json,
  };
}

export function parseAnalysis(row: SubmissionRow): SubmissionAnalysis {
  return JSON.parse(row.analysisJson) as SubmissionAnalysis;
}

export class SubmissionsRepository {
  constructor(private readonly db: Database) {}

  migrate(): void {
    // `job_id ... REFERENCES jobs(id) ON DELETE CASCADE` — matches
    // runs.repository.ts's pattern: deleting a job row (job.service.ts's
    // existing `deleteJob()` / `sweepExpiredJobs()`, both call
    // `jobsRepo.delete(id)`) cascades to remove this job's submission rows
    // too, with zero changes needed in job.service.ts. Requires `PRAGMA
    // foreign_keys = ON` on the shared connection, which runs.repository.ts
    // already enables once per connection (pragma is connection-scoped, not
    // table-scoped, so enabling it anywhere before the first DELETE is
    // sufficient regardless of migrate() call order). Submission *files*
    // live under `<jobDir>/submissions/`, so `deleteJobDir()` already
    // removes them as part of the job directory — only the SQL rows needed
    // this cascade.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        text_sha256 TEXT NOT NULL,
        text_length INTEGER NOT NULL,
        source TEXT NOT NULL,
        analysis_json TEXT NOT NULL
      );
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_submissions_job_id ON submissions(job_id);");
  }

  insert(record: SubmissionRow): void {
    this.db
      .query(
        `INSERT INTO submissions (id, job_id, label, created_at, text_sha256, text_length, source, analysis_json)
         VALUES ($id, $jobId, $label, $createdAt, $textSha256, $textLength, $source, $analysisJson)`,
      )
      .run({
        $id: record.id,
        $jobId: record.jobId,
        $label: record.label,
        $createdAt: record.createdAt,
        $textSha256: record.textSha256,
        $textLength: record.textLength,
        $source: record.source,
        $analysisJson: record.analysisJson,
      });
  }

  findById(id: string): SubmissionRow | null {
    const row = this.db.query("SELECT * FROM submissions WHERE id = ?").get(id) as DbRow | null;
    return row ? rowToRecord(row) : null;
  }

  findByJobId(jobId: string): SubmissionRow[] {
    const rows = this.db
      .query("SELECT * FROM submissions WHERE job_id = ? ORDER BY created_at ASC")
      .all(jobId) as DbRow[];
    return rows.map(rowToRecord);
  }

  countByJobId(jobId: string): number {
    const row = this.db
      .query("SELECT COUNT(*) as n FROM submissions WHERE job_id = ?")
      .get(jobId) as { n: number };
    return row.n;
  }

  updateAnalysis(id: string, analysisJson: string): void {
    this.db
      .query("UPDATE submissions SET analysis_json = $analysisJson WHERE id = $id")
      .run({ $analysisJson: analysisJson, $id: id });
  }

  delete(id: string): void {
    this.db.query("DELETE FROM submissions WHERE id = ?").run(id);
  }

  deleteByJobId(jobId: string): void {
    this.db.query("DELETE FROM submissions WHERE job_id = ?").run(jobId);
  }
}
