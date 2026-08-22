import type { Database } from "bun:sqlite";
import type { RunStatus } from "@pdf-injection/contracts";

/**
 * bun:sqlite-backed repository for background research runs (§2 model-tests,
 * §4 robustness). Two tables, identical shape, kept separate to match the
 * contract's own naming (`model_test_runs` / `robustness_runs`) rather than a
 * single polymorphic table. Both declare `job_id REFERENCES jobs(id) ON
 * DELETE CASCADE` — `migrate()` turns on `PRAGMA foreign_keys` on the shared
 * connection so deleting a job (jobsRepo.delete()) automatically removes its
 * run rows too, with zero changes needed to job.service.ts's deleteJob().
 *
 * `config_json` never contains the hidden instruction — only provider/
 * condition/repeats/outerPrompt-shaped request config (see model-test /
 * robustness services for exactly what's serialized).
 */
export interface RunRow {
  id: string;
  jobId: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  configJson: string;
  progressDone: number;
  progressTotal: number;
  errorCode: string | null;
}

interface DbRunRow {
  id: string;
  job_id: string;
  status: RunStatus;
  created_at: string;
  updated_at: string;
  config_json: string;
  progress_done: number;
  progress_total: number;
  error_code: string | null;
}

function rowToRecord(row: DbRunRow): RunRow {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    configJson: row.config_json,
    progressDone: row.progress_done,
    progressTotal: row.progress_total,
    errorCode: row.error_code,
  };
}

class RunTable {
  constructor(
    private readonly db: Database,
    private readonly tableName: "model_test_runs" | "robustness_runs",
  ) {}

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        config_json TEXT NOT NULL,
        progress_done INTEGER NOT NULL DEFAULT 0,
        progress_total INTEGER NOT NULL DEFAULT 0,
        error_code TEXT
      );
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_job_id ON ${this.tableName}(job_id);`,
    );
  }

  insert(row: RunRow): void {
    this.db
      .query(
        `INSERT INTO ${this.tableName}
          (id, job_id, status, created_at, updated_at, config_json, progress_done, progress_total, error_code)
         VALUES ($id, $jobId, $status, $createdAt, $updatedAt, $configJson, $progressDone, $progressTotal, $errorCode)`,
      )
      .run({
        $id: row.id,
        $jobId: row.jobId,
        $status: row.status,
        $createdAt: row.createdAt,
        $updatedAt: row.updatedAt,
        $configJson: row.configJson,
        $progressDone: row.progressDone,
        $progressTotal: row.progressTotal,
        $errorCode: row.errorCode,
      });
  }

  updateProgress(id: string, done: number, total: number): void {
    this.db
      .query(
        `UPDATE ${this.tableName} SET progress_done = $done, progress_total = $total, updated_at = $now WHERE id = $id`,
      )
      .run({ $done: done, $total: total, $now: new Date().toISOString(), $id: id });
  }

  updateStatus(id: string, status: RunStatus, errorCode: string | null): void {
    this.db
      .query(
        `UPDATE ${this.tableName} SET status = $status, error_code = $errorCode, updated_at = $now WHERE id = $id`,
      )
      .run({ $status: status, $errorCode: errorCode, $now: new Date().toISOString(), $id: id });
  }

  findById(id: string): RunRow | null {
    const row = this.db
      .query(`SELECT * FROM ${this.tableName} WHERE id = ?`)
      .get(id) as DbRunRow | null;
    return row ? rowToRecord(row) : null;
  }

  findByJobId(jobId: string): RunRow[] {
    const rows = this.db
      .query(`SELECT * FROM ${this.tableName} WHERE job_id = ? ORDER BY created_at DESC`)
      .all(jobId) as DbRunRow[];
    return rows.map(rowToRecord);
  }

  delete(id: string): void {
    this.db.query(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
  }
}

export class RunsRepository {
  readonly modelTests: RunTable;
  readonly robustness: RunTable;

  constructor(private readonly db: Database) {
    this.modelTests = new RunTable(db, "model_test_runs");
    this.robustness = new RunTable(db, "robustness_runs");
  }

  migrate(): void {
    // Enables ON DELETE CASCADE for both tables' `job_id` foreign key on
    // this connection (bun:sqlite, like sqlite3 generally, defaults foreign
    // keys OFF). This is the only reason model_test_runs / robustness_runs
    // rows are removed when a job is deleted — job.service.ts's deleteJob()
    // needs zero changes for run rows to disappear with their job.
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.modelTests.migrate();
    this.robustness.migrate();
  }
}
