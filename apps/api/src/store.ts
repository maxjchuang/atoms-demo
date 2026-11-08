import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentEventDto, ArtifactManifestDto, ProjectDto, ProjectEventDto, RunDto, StartExecutionDto, VersionDto } from '@atoms/contracts';

export interface Code { id: string; hash: string; expiresAt: string; projectLimit: number; runLimit: number; revoked: boolean }
export interface SessionRecord { id: string; codeId: string; tokenHash: string; expiresAt: string }
export interface ProjectRecord { dto: ProjectDto; codeId: string }
export interface RunRecord { dto: RunDto; prompt: string; codeId: string; started: boolean; sourceSeq: number;
  request?: StartExecutionDto; manifestHash?: string; answerCommand?: object; cancelCommand?: object }
export interface VersionRecord { dto: VersionDto; artifactId: string; manifest: ArtifactManifestDto; manifestRaw: string; directory: string }
export interface MessageRecord { id: string; projectId: string; runId: string | null; role: 'user'|'assistant';
  status: 'streaming'|'complete'; content: string; createdAt: string }
export interface IdempotentResult { hash: string; status: number; body?: unknown; cookie?: string }
export interface State { codes: Code[]; sessions: SessionRecord[]; projects: ProjectRecord[]; runs: RunRecord[];
  versions: VersionRecord[]; messages: MessageRecord[]; events: ProjectEventDto[]; sourceEvents: AgentEventDto[];
  idempotency: Record<string, IdempotentResult> }
const empty = (): State => ({ codes: [], sessions: [], projects: [], runs: [], versions: [], messages: [], events: [], sourceEvents: [], idempotency: {} });

/** Single API process owns this SQLite database. State changes are atomic snapshots. */
export class Store {
  readonly db: DatabaseSync;
  state: State;
  constructor(filename: string) {
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL)');
    const row = this.db.prepare('SELECT document FROM app_state WHERE id=1').get() as { document: string } | undefined;
    this.state = row ? JSON.parse(row.document) : empty();
  }
  transaction<T>(fn: () => T): T {
    const before = JSON.stringify(this.state);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.prepare('INSERT INTO app_state(id,document) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(JSON.stringify(this.state));
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK'); this.state = JSON.parse(before); throw error;
    }
  }
  close() { this.db.close(); }
}
