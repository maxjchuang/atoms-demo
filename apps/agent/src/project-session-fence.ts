import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type FenceState = { generation: number; dirty: boolean; activeTurnId: string | null; lastCommittedTurnId: string | null };
/** Technical session state only. API decisions remain the business memory authority. */
export class ProjectSessionFence {
  private file: string;
  constructor(home: string) { mkdirSync(home, { recursive: true }); this.file = path.join(home, 'session-fence.json'); }
  state(): FenceState {
    return existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) as FenceState
      : { generation: 0, dirty: false, activeTurnId: null, lastCommittedTurnId: null };
  }
  private write(value: FenceState) { writeFileSync(this.file + '.tmp', JSON.stringify(value)); renameSync(this.file + '.tmp', this.file); }
  begin(turnId: string) {
    const state = this.state();
    if (state.generation === 0 || (state.dirty && state.activeTurnId !== turnId)) state.generation++;
    state.dirty = true; state.activeTurnId = turnId; this.write(state); return state.generation;
  }
  commit(turnId: string) {
    const state = this.state();
    if (state.activeTurnId !== turnId) return false;
    state.dirty = false; state.activeTurnId = null; state.lastCommittedTurnId = turnId; this.write(state); return true;
  }
  invalidate() {
    const state = this.state(); state.dirty = true; state.activeTurnId = null; this.write(state);
  }
}
