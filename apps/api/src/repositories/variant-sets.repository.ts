import type { Database } from "bun:sqlite";

/**
 * bun:sqlite-backed repository for round-2 §1 variant-sets / student-keyed
 * sets. Parameterized queries only. Instruction text / student keys are
 * never columns here — those live only in `mapping.json` /
 * `variant-set.private-manifest.json` under the set's private storage
 * directory (per contract), never logged, never in this table.
 */
export type SetKind = "variant" | "student_keyed";

export interface VariantSetRow {
  id: string;
  kind: SetKind;
  accessTokenHash: string;
  sourceSha256: string;
  createdAt: string;
  expiresAt: string;
  /** Free-form JSON blob for kind-specific metadata (e.g. sourceFilename, instructionTemplate hash). Never instruction text / keys. */
  metaJson: string;
}

interface SetRow {
  id: string;
  kind: SetKind;
  access_token_hash: string;
  source_sha256: string;
  created_at: string;
  expires_at: string;
  meta_json: string;
}

function rowToRecord(row: SetRow): VariantSetRow {
  return {
    id: row.id,
    kind: row.kind,
    accessTokenHash: row.access_token_hash,
    sourceSha256: row.source_sha256,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    metaJson: row.meta_json,
  };
}

export interface VariantSetMemberRow {
  setId: string;
  /** The variant `label` (kind="variant") or `studentId` (kind="student_keyed"). */
  labelOrStudentId: string;
  jobId: string;
  /** The generated student key (kind="student_keyed" only, otherwise null). Never logged. */
  keyOrNull: string | null;
}

interface MemberRow {
  set_id: string;
  label_or_student_id: string;
  job_id: string;
  key_or_null: string | null;
}

function memberRowToRecord(row: MemberRow): VariantSetMemberRow {
  return {
    setId: row.set_id,
    labelOrStudentId: row.label_or_student_id,
    jobId: row.job_id,
    keyOrNull: row.key_or_null,
  };
}

export class VariantSetsRepository {
  constructor(private readonly db: Database) {}

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS variant_sets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        access_token_hash TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        meta_json TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS variant_set_members (
        set_id TEXT NOT NULL,
        label_or_student_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        key_or_null TEXT,
        PRIMARY KEY (set_id, label_or_student_id)
      );
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_variant_set_members_set_id ON variant_set_members(set_id);",
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_variant_sets_expires_at ON variant_sets(expires_at);",
    );
  }

  insertSet(record: VariantSetRow): void {
    this.db
      .query(
        `INSERT INTO variant_sets (id, kind, access_token_hash, source_sha256, created_at, expires_at, meta_json)
         VALUES ($id, $kind, $accessTokenHash, $sourceSha256, $createdAt, $expiresAt, $metaJson)`,
      )
      .run({
        $id: record.id,
        $kind: record.kind,
        $accessTokenHash: record.accessTokenHash,
        $sourceSha256: record.sourceSha256,
        $createdAt: record.createdAt,
        $expiresAt: record.expiresAt,
        $metaJson: record.metaJson,
      });
  }

  insertMember(member: VariantSetMemberRow): void {
    this.db
      .query(
        `INSERT INTO variant_set_members (set_id, label_or_student_id, job_id, key_or_null)
         VALUES ($setId, $labelOrStudentId, $jobId, $keyOrNull)`,
      )
      .run({
        $setId: member.setId,
        $labelOrStudentId: member.labelOrStudentId,
        $jobId: member.jobId,
        $keyOrNull: member.keyOrNull,
      });
  }

  findById(id: string): VariantSetRow | null {
    const row = this.db.query("SELECT * FROM variant_sets WHERE id = ?").get(id) as SetRow | null;
    return row ? rowToRecord(row) : null;
  }

  findMembers(setId: string): VariantSetMemberRow[] {
    const rows = this.db
      .query("SELECT * FROM variant_set_members WHERE set_id = ? ORDER BY rowid ASC")
      .all(setId) as MemberRow[];
    return rows.map(memberRowToRecord);
  }

  deleteSet(id: string): void {
    this.db.query("DELETE FROM variant_set_members WHERE set_id = ?").run(id);
    this.db.query("DELETE FROM variant_sets WHERE id = ?").run(id);
  }

  findExpired(nowIso: string): VariantSetRow[] {
    const rows = this.db
      .query("SELECT * FROM variant_sets WHERE expires_at < ?")
      .all(nowIso) as SetRow[];
    return rows.map(rowToRecord);
  }
}
