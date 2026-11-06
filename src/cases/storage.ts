import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { disputeSchema, type Dispute } from '../paypal/schemas';
import { scenarioIds, type ScenarioId } from '../records';
import type { AgentRun, CaseFileVersion, Approval, SubmissionAttempt } from '../agent/schema';

export class ResolvedCaseError extends Error {}
export class PendingSubmissionError extends Error {}
export class ReplayCaseError extends Error {}
const migrations = [
  `CREATE TABLE cases (
     dispute_id TEXT PRIMARY KEY,
     snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
     fingerprint TEXT NOT NULL,
     synced_at TEXT NOT NULL
   );
   CREATE TABLE case_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     dispute_id TEXT NOT NULL REFERENCES cases(dispute_id),
     kind TEXT NOT NULL CHECK(kind = 'snapshot_changed'),
     snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
     observed_at TEXT NOT NULL
   );
   CREATE INDEX case_events_dispute_id ON case_events(dispute_id, id);
   CREATE TRIGGER case_events_no_update BEFORE UPDATE ON case_events
     BEGIN SELECT RAISE(ABORT, 'case_events is append-only'); END;
   CREATE TRIGGER case_events_no_delete BEFORE DELETE ON case_events
     BEGIN SELECT RAISE(ABORT, 'case_events is append-only'); END;`,
  `CREATE TABLE case_scenarios (dispute_id TEXT PRIMARY KEY REFERENCES cases(dispute_id), scenario_id TEXT NOT NULL);
   CREATE TABLE agent_runs (id TEXT PRIMARY KEY, dispute_id TEXT NOT NULL REFERENCES cases(dispute_id), data TEXT NOT NULL);
   CREATE TABLE case_file_versions (id TEXT PRIMARY KEY, dispute_id TEXT NOT NULL REFERENCES cases(dispute_id), data TEXT NOT NULL);
   CREATE TABLE approvals (id TEXT PRIMARY KEY, dispute_id TEXT NOT NULL REFERENCES cases(dispute_id), data TEXT NOT NULL);
   CREATE TABLE submission_attempts (id TEXT PRIMARY KEY, dispute_id TEXT NOT NULL REFERENCES cases(dispute_id), stage TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
   CREATE UNIQUE INDEX no_duplicate_stage_write ON submission_attempts(dispute_id, stage) WHERE status IN ('submitting','submitted','unknown');
   CREATE TABLE investigation_limits (ip_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);`,
  `CREATE TABLE daily_investigations (day TEXT PRIMARY KEY, count INTEGER NOT NULL);
   CREATE TRIGGER block_pending_version BEFORE INSERT ON case_file_versions
   WHEN EXISTS (SELECT 1 FROM submission_attempts WHERE dispute_id=NEW.dispute_id AND status IN ('submitting','unknown'))
   BEGIN SELECT RAISE(ABORT, 'Submission is pending'); END;
   CREATE TRIGGER block_pending_run BEFORE INSERT ON agent_runs
   WHEN EXISTS (SELECT 1 FROM submission_attempts WHERE dispute_id=NEW.dispute_id AND status IN ('submitting','unknown'))
   BEGIN SELECT RAISE(ABORT, 'Submission is pending'); END;`,
  `CREATE TABLE replay_cases (dispute_id TEXT PRIMARY KEY REFERENCES cases(dispute_id));`,
];

// Object property order and HATEOAS link order have no business meaning.
function canonical(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    const items = value.map(v => canonical(v));
    return key === 'links' ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonical(v, k)]));
  }
  return value;
}

export interface CaseEvent { id: number; disputeId: string; kind: string; snapshot: Dispute; observedAt: string }
export class CaseStore {
  private readonly db: DatabaseSync;
  private closed = false;
  constructor(path = process.env.DATABASE_PATH ?? './data/counterclaim.db') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
      if (version > migrations.length) throw new Error('Database schema is newer than this application');
      for (let i = version; i < migrations.length; i++) {
        this.db.exec(migrations[i]!);
        this.db.exec(`PRAGMA user_version = ${i + 1}`);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); this.db.close(); throw error; }
  }
  /** Synchronous writes hold the same lock across validation and persistence. */
  transaction<T>(work: () => T): T {
    if (this.db.isTransaction) return work();
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  snapshotFingerprint(id: string): string {
    const row = this.db.prepare('SELECT fingerprint FROM cases WHERE dispute_id=?').get(id);
    if (!row) throw new Error('Case not found');
    return createHash('sha256').update(String(row.fingerprint)).digest('hex');
  }
  get(id: string): Dispute | undefined {
    const row = this.db.prepare('SELECT snapshot FROM cases WHERE dispute_id = ?').get(id);
    return row ? disputeSchema.parse(JSON.parse(String(row.snapshot))) : undefined;
  }
  ids(): string[] { return this.db.prepare('SELECT dispute_id FROM cases ORDER BY dispute_id').all().map(r => String(r.dispute_id)); }
  save(input: Dispute): boolean {
    const dispute = disputeSchema.parse(input);
    const snapshot = JSON.stringify(dispute);
    const fingerprint = JSON.stringify(canonical(dispute));
    const now = new Date().toISOString();
    return this.transaction(() => {
      const old = this.db.prepare('SELECT fingerprint FROM cases WHERE dispute_id = ?').get(dispute.dispute_id);
      const changed = old?.fingerprint !== fingerprint;
      this.db.prepare(`INSERT INTO cases (dispute_id, snapshot, fingerprint, synced_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(dispute_id) DO UPDATE SET snapshot=excluded.snapshot, fingerprint=excluded.fingerprint, synced_at=excluded.synced_at`)
        .run(dispute.dispute_id, snapshot, fingerprint, now);
      if (changed) this.db.prepare("INSERT INTO case_events (dispute_id, kind, snapshot, observed_at) VALUES (?, 'snapshot_changed', ?, ?)")
        .run(dispute.dispute_id, snapshot, now);
      return changed;
    });
  }
  history(id: string): CaseEvent[] {
    return this.db.prepare('SELECT * FROM case_events WHERE dispute_id = ? ORDER BY id').all(id).map(row => ({
      id: Number(row.id), disputeId: String(row.dispute_id), kind: String(row.kind),
      snapshot: disputeSchema.parse(JSON.parse(String(row.snapshot))), observedAt: String(row.observed_at),
    }));
  }
  assignScenario(id: string, scenario: ScenarioId) {
    if (!scenarioIds.includes(scenario)) throw new Error('Unknown scenario');
    if (!this.get(id)) throw new Error('Case not found');
    this.db.prepare('INSERT INTO case_scenarios VALUES (?, ?) ON CONFLICT(dispute_id) DO UPDATE SET scenario_id=excluded.scenario_id').run(id, scenario);
  }
  scenario(id: string): ScenarioId | undefined {
    return this.db.prepare('SELECT scenario_id FROM case_scenarios WHERE dispute_id=?').get(id)?.scenario_id as ScenarioId | undefined;
  }
  saveRun(run: AgentRun) {
    const data = JSON.stringify(run);
    if (!this.db.prepare('UPDATE agent_runs SET data=? WHERE id=? AND dispute_id=?').run(data, run.id, run.disputeId).changes) this.db.prepare('INSERT INTO agent_runs VALUES (?, ?, ?)').run(run.id, run.disputeId, data);
  }
  runs(id: string): AgentRun[] { return this.db.prepare('SELECT data FROM agent_runs WHERE dispute_id=? ORDER BY rowid').all(id).map(r => JSON.parse(String(r.data))); }
  addVersion(v: CaseFileVersion) { this.assertMutable(v.disputeId); this.db.prepare('INSERT INTO case_file_versions VALUES (?, ?, ?)').run(v.id, v.disputeId, JSON.stringify(v)); }
  /** Offline seed upgrades only: preserve old versions and never unlock a replay for API writes. */
  importReplayVersion(v: CaseFileVersion) {
    if (!this.isReplay(v.disputeId) || !v.guard.accepted || this.approvals(v.disputeId).length || this.attempts(v.disputeId).length)
      throw new Error('Only accepted, untouched replay fixtures may be imported');
    this.db.prepare('INSERT INTO case_file_versions VALUES (?, ?, ?)').run(v.id, v.disputeId, JSON.stringify(v));
  }
  versions(id: string): CaseFileVersion[] { return this.db.prepare('SELECT data FROM case_file_versions WHERE dispute_id=? ORDER BY rowid').all(id).map(r => JSON.parse(String(r.data))); }
  addApproval(a: Approval) { this.db.prepare('INSERT INTO approvals VALUES (?, ?, ?)').run(a.id, a.disputeId, JSON.stringify(a)); }
  approvals(id: string): Approval[] { return this.db.prepare('SELECT data FROM approvals WHERE dispute_id=? ORDER BY rowid').all(id).map(r => JSON.parse(String(r.data))); }
  lastSyncedAt(id: string): string | undefined { return this.db.prepare('SELECT synced_at FROM cases WHERE dispute_id=?').get(id)?.synced_at as string | undefined; }
  markReplay(id: string) { this.db.prepare('INSERT OR IGNORE INTO replay_cases VALUES (?)').run(id); }
  isReplay(id: string): boolean { return !!this.db.prepare('SELECT 1 FROM replay_cases WHERE dispute_id=?').get(id); }
  assertNotReplay(id: string) { if (this.isReplay(id)) throw new ReplayCaseError('Read-only replay: no writes are allowed'); }
  assertMutable(id: string) {
    this.assertNotReplay(id);
    if (this.get(id)?.status === 'RESOLVED') throw new ResolvedCaseError('Case is resolved. No response is due.');
    if (this.db.prepare("SELECT 1 FROM submission_attempts WHERE dispute_id=? AND status IN ('submitting','unknown')").get(id)) throw new PendingSubmissionError('Submission is pending');
  }
  reserveSubmission(a: SubmissionAttempt) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.assertMutable(a.disputeId);
      if (this.versions(a.disputeId).at(-1)?.id !== a.versionId) throw new Error('Case file version changed');
      this.addAttempt(a); this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  addAttempt(a: SubmissionAttempt) { this.db.prepare('INSERT INTO submission_attempts VALUES (?, ?, ?, ?, ?)').run(a.id, a.disputeId, a.stage, a.status, JSON.stringify(a)); }
  saveAttempt(a: SubmissionAttempt) { this.db.prepare('UPDATE submission_attempts SET status=?, data=? WHERE id=?').run(a.status, JSON.stringify(a), a.id); }
  attempts(id: string): SubmissionAttempt[] { return this.db.prepare('SELECT data FROM submission_attempts WHERE dispute_id=? ORDER BY rowid').all(id).map(r => JSON.parse(String(r.data))); }
  takeInvestigationSlot(ipHash: string, now = Date.now()): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const day = new Date(now).toISOString().slice(0, 10);
      const configured = process.env.MAX_INVESTIGATIONS_PER_DAY ?? '50';
      const cap = Number(configured);
      if (!Number.isSafeInteger(cap) || cap < 0) throw new Error('Invalid daily investigation limit');
      const daily = Number(this.db.prepare('SELECT count FROM daily_investigations WHERE day=?').get(day)?.count ?? 0);
      if (daily >= cap) { this.db.exec('COMMIT'); return false; }
      const row = this.db.prepare('SELECT * FROM investigation_limits WHERE ip_hash=?').get(ipHash);
      if (row && now - Number(row.window_start) < 3600000 && Number(row.count) >= 4) { this.db.exec('COMMIT'); return false; }
      const start = row && now - Number(row.window_start) < 3600000 ? Number(row.window_start) : now;
      const count = row && now - Number(row.window_start) < 3600000 ? Number(row.count) + 1 : 1;
      this.db.prepare('INSERT INTO investigation_limits VALUES (?, ?, ?) ON CONFLICT(ip_hash) DO UPDATE SET window_start=excluded.window_start, count=excluded.count').run(ipHash, start, count);
      this.db.prepare('INSERT INTO daily_investigations VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count=count+1').run(day);
      this.db.exec('COMMIT'); return true;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  checkHealth() { this.db.prepare('SELECT 1').get(); }
  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
}
