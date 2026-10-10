/** Spectator analytics only. Never included in citizen observations or model context. */
export const HISTORY_CADENCE = 20;
export const HISTORY_LIMIT = 256;
export interface CitizenSample {
  alive: boolean;
  cash: number;
  escrow: number;
  health: number;
  fullness: number;
}
export interface MarketSample {
  bid: number | null;
  ask: number | null;
  lastPrice: number | null;
  lastTick: number | null;
  supply: number;
  demand: number;
  carried: number;
  held: number;
  ground: number;
  units: number;
  turnover: number;
  fills: number;
}
export interface HistoryFrame {
  tick: number;
  population: number;
  meanHealth: number;
  meanFullness: number;
  citizens: Record<string, CitizenSample>;
  markets: Record<string, MarketSample>;
}
export interface WorldTelemetry {
  version: 1;
  startedTick: number;
  frames: HistoryFrame[];
  pending: Record<string, { units: number; turnover: number; fills: number }>;
  last: Record<string, { price: number; tick: number }>;
}
export interface HistoryMeta {
  runId: string;
  tick: number;
  startedTick: number;
  cadence: number;
  limit: number;
}
export interface GlobalHistory extends HistoryMeta {
  frames: Omit<HistoryFrame, 'citizens'>[];
}
export interface CitizenHistory extends HistoryMeta {
  citizenId: string;
  points: (CitizenSample & { tick: number })[];
}
