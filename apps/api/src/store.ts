import type { DeliveryExecutionRequestDto, PrepareDeliveryPlanRequestDto, DeliveryReportDto } from '@atoms/contracts/delivery';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentEventDto, ArtifactManifestDto, ProjectDto, ProjectEventDto, RunDto, StartExecutionDto, VersionDto } from '@atoms/contracts';
import type { ConversationMessageDto, CoordinationTurnDto, StartCoordinationRequestDto, ConversationEventDto,
  ChangeProposalDto, ClarificationDto, ProjectMemoryViewDto, RouterResultDto } from '@atoms/contracts/conversation';

export interface Code { id: string; hash: string; expiresAt: string; projectLimit: number; runLimit: number; revoked: boolean;publicIssuedAt?:string }
export interface SessionRecord { id: string; codeId: string; tokenHash: string; expiresAt: string }
export interface ProjectRecord { dto: ProjectDto; codeId: string }
export interface RunRecord { dto: RunDto; prompt: string; codeId: string; started: boolean; sourceSeq: number;
  request?: StartExecutionDto; manifestHash?: string; answerCommand?: object; cancelCommand?: object;
  isolationWaiting?:boolean; runtimeDisconnected?: boolean; originTurnId?: string; sourceMessageId?: string; proposalId?: string;
  requirementsSummary?:{id:string;hash:string;revision:number;confirmedSnapshotId:string};exactBaseVersionId?: string | null; delivery?: DeliveryRecord; budgetContinuation?:boolean; recovery?:{parentRunId:string;rootRunId:string;segment:number;request:import('@atoms/contracts/budget-recovery').RecoveryExecutionRequestDto} }
export interface DeliveryRecord {
  stage:'preparing'|'executing'; preparationId:string; planningSeq:number;
  prepare?:PrepareDeliveryPlanRequestDto; prepareHash?:string; wrapper?:DeliveryExecutionRequestDto;
  putPending?:boolean; prepareAccepted?:boolean; executionPutPending?:boolean;executionAccepted?:boolean; runtimeStopped?:boolean; noReportExpected?:boolean; report?:DeliveryReportDto; invalid?:string;invalidReason?:string;
  sealedIdentities?:{kind:'clean'|'export'|'archive';id:string;bodyHash:string}[];
  reportDirectory?:string; archiveFile?:string; verified?:boolean; finalUsage?:ReturnType<typeof import('@atoms/contracts/delivery').BudgetUsage.parse>;
}
export interface CoordinationRecord { dto: CoordinationTurnDto; codeId: string; operation: StartCoordinationRequestDto['operation'];
  inputContent: string; replyTo?: StartCoordinationRequestDto['replyTo']; request?: StartCoordinationRequestDto; requestHash?: string;
  sourceSeq: number; started: boolean; cancelCommand?: {commandId: string}; disconnected?: boolean;
  requirementsReview?:ReturnType<typeof import('@atoms/contracts/requirements').RequirementSnapshotRef.parse>;requirementsRequest?:import('@atoms/contracts/requirements').RequirementsCoordinationRequestDto;requirementsResponse?:import('@atoms/contracts/requirements').RequirementsCoordinationSnapshotDto;requestedContextVersionId?:string|null; deliveryRequest?:import('@atoms/contracts/delivery').DeliveryCoordinationRequestDto; putPending?:boolean; cancelUncertainNotified?:boolean }
export interface CoordinationState { turns: CoordinationRecord[]; messages: ConversationMessageDto[]; events: ConversationEventDto[];
  proposals: ChangeProposalDto[]; clarifications: ClarificationDto[]; memories: ProjectMemoryViewDto[];
  revisions: Record<string, number>; proposalMemorySuggestions:Record<string,RouterResultDto['memoryUpdates']>;
  proposalConfirmations:{proposalId:string;runId:string;actorSessionId:string|null;kind:'explicit_accept'|'auto_clear';confirmedAt:string;proposalRevision:number}[] }
const emptyCoordination = (): CoordinationState => ({ turns: [], messages: [], events: [], proposals: [], clarifications: [], memories: [], revisions: {},proposalMemorySuggestions:{},proposalConfirmations:[] });
export interface VersionRecord { dto: VersionDto; artifactId: string; manifest: ArtifactManifestDto; manifestRaw: string; directory: string; deliveryOriginRunId?:string }
export interface MessageRecord { id: string; projectId: string; runId: string | null; role: 'user'|'assistant';
  status: 'streaming'|'complete'; content: string; createdAt: string }
export interface IdempotentResult { hash: string; status: number; body?: unknown; cookie?: string }
export interface BudgetRecoveryOrigin {view?:ReturnType<typeof import('@atoms/contracts/budget-recovery').RecoveryRuntimeView.parse>;invalid?:boolean;checkedAt?:number;auditAt?:number;quote?:ReturnType<typeof import('@atoms/contracts/budget-recovery').RecoveryOffer.parse>;revision:number;stopCommand?:ReturnType<typeof import('@atoms/contracts/budget-recovery').RecoveryStopRequest.parse>}
export interface BudgetRecoveryState {origins:Record<string,BudgetRecoveryOrigin>;successors:Record<string,{runId:string;operationId:string;codeId:string;requestHash:string}>;keys:Record<string,{requestHash:string;runId:string;operationId:string}>}
export interface State { budgetRecovery?:BudgetRecoveryState; codes: Code[]; sessions: SessionRecord[]; projects: ProjectRecord[]; runs: RunRecord[];
  versions: VersionRecord[]; messages: MessageRecord[]; events: ProjectEventDto[]; sourceEvents: AgentEventDto[];
  idempotency: Record<string, IdempotentResult>; coordination: CoordinationState }
const empty = (): State => ({ codes: [], sessions: [], projects: [], runs: [], versions: [], messages: [], events: [], sourceEvents: [], idempotency: {}, coordination: emptyCoordination() });

/** Single API process owns this SQLite database. State changes are atomic snapshots. */
export class Store {
  private transactionDepth=0;
  get inTransaction(){return this.transactionDepth>0;}
  readonly db: DatabaseSync;
  state: State;
  constructor(filename: string) {
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL)');
    const row = this.db.prepare('SELECT document FROM app_state WHERE id=1').get() as { document: string } | undefined;
    this.state = row ? JSON.parse(row.document) : empty();
    // Additive migration only. Original identity, quotas, messages, events and versions remain intact.
    this.state.coordination ??= emptyCoordination();
    this.state.coordination.proposalMemorySuggestions??={};this.state.coordination.proposalConfirmations??=[];
  }
  transaction<T>(fn: () => T): T {
    const before = JSON.stringify(this.state);
    this.db.exec('BEGIN IMMEDIATE');this.transactionDepth++;
    try {
      const result = fn();
      this.db.prepare('INSERT INTO app_state(id,document) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(JSON.stringify(this.state));
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK'); this.state = JSON.parse(before); throw error;
    }finally{this.transactionDepth--;}
  }
  close() { this.db.close(); }
}
