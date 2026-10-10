/** Lightweight spectator transport, never citizen knowledge or a checkpoint. */
export interface MotionCitizen {
  id: string;
  x: number;
  y: number;
  alive: boolean;
  progress?: number;
}
export interface MotionFrame {
  tick: number;
  at: number;
  citizens: MotionCitizen[];
}
export interface MotionSnapshot {
  runId: string;
  streamId: string;
  tick: number;
  running: boolean;
  tickMs: number;
  frames: MotionFrame[];
}
