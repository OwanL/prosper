import type { PlanReceipt, PlanState } from './plan-types.ts';
import type { DirectiveState, DirectiveReceipt, EmergencyFeeding } from './directive-types.ts';
import type { AutonomyState, TerritorialClaim, Alliance } from './autonomy-types.ts';
import type { WorldTelemetry } from './telemetry-types.ts';

// Shared data contracts. World data must survive a JSON round trip.
export { TIERS } from './tiers.ts';
export type { Tier } from './tiers.ts';
import type { Tier } from './tiers.ts';
export type Resource = 'food' | 'wood' | 'fibre';
export type ToolKind = 'axe' | 'scythe' | 'knife' | 'sword';
export type BuildingKind = 'lumbermill' | 'spinning-wheel' | 'butchery' | 'wall';
export type ItemKey = string; // `${resource or tool kind}:${tier}`
export type Inventory = Record<ItemKey, number>;
export interface Point {
  x: number;
  y: number;
}
export type Region = 'center' | `ring${number}`;
export type QueueMode = 'replace' | 'append';
export type Command = (
  | { type: 'move'; x: number; y: number }
  | { type: 'harvest'; depositId: string }
  | { type: 'craft'; item: ToolKind; tier: Tier }
  | { type: 'build'; kind: BuildingKind; tier: Tier; x: number; y: number }
  | { type: 'refine'; buildingId: string; fromTier: Tier; direction?: 'up' | 'down' }
  | { type: 'attack'; targetId: string }
  | { type: 'loot'; lootId: string }
  | { type: 'cancel' }
  | { type: 'order'; side: 'buy' | 'sell'; item: ItemKey; quantity: number; price: number }
  | { type: 'cancel-order'; orderId: string }
  | { type: 'transfer'; citizenId: string; gold: number }
  | { type: 'give'; citizenId: string; item: ItemKey; quantity: number }
  | { type: 'message'; text: string; to?: string }
  | { type: 'remember'; text: string }
  | { type: 'goals'; goals: string[] }
  | { type: 'reproduce'; partnerId: string }
  | { type: 'consent'; partnerId: string; accept: boolean }
) & { queue?: QueueMode };
export interface Action {
  id: string;
  command: Command;
  phase: 'travel' | 'work';
  startedTick: number;
  elapsed: number;
  duration: number;
  reserved: Inventory;
  path: Point[];
  target: Point;
  partnerId?: string;
}
export interface Memory {
  tick: number;
  text: string;
}
export interface Citizen extends Point {
  /** Optional on old checkpoints and isolated mechanics fixtures. */
  autonomy?: AutonomyState;
  id: string;
  name: string;
  color: string;
  personality: string;
  alive: boolean;
  health: number;
  fullness: number;
  gold: number;
  inventory: Inventory;
  action: Action | null;
  queue: Command[];
  /** Approved work only. Drafts belong to an ephemeral reasoning turn. */
  plan?: PlanState;
  planReceipts?: PlanReceipt[];
  strategy?: DirectiveState;
  directiveReceipts?: DirectiveReceipt[];
  emergency?: EmergencyFeeding;
  goals: string[];
  memories: Memory[];
  knowledge: Record<string, TileMemory>;
  lastResult: string;
  nextReviewTick: number;
  /** Optional for old checkpoints. Acknowledged personal wakeups, not a work quota. */
  review?: {
    eventSequence: number;
    foodRisk: 0 | 1 | 2;
    planningWorkId?: string;
    replanLeadTicks?: number;
    /** Last attempted compact review; routine events do not create paid wakeups. */
    strategicTick?: number;
  };
  consent: Record<string, number>;
  reproductionCooldown: number;
  parents: string[];
}
export interface Deposit extends Point {
  id: string;
  resource: Resource;
  tier: Tier;
  stock: number;
  capacity: number;
  regrowAt: number;
}
export interface Building extends Point {
  id: string;
  kind: BuildingKind;
  tier: Tier;
  ownerId: string | null;
  health: number;
  maxHealth: number;
  materials: Inventory;
}
export interface Order {
  id: string;
  citizenId: string;
  side: 'buy' | 'sell';
  item: ItemKey;
  quantity: number;
  price: number;
  createdTick: number;
  sequence: number;
  escrowGold: number;
  escrowItems: Inventory;
}
export interface Loot extends Point {
  id: string;
  citizenName: string;
  gold: number;
  inventory: Inventory;
}
export interface Message {
  id: string;
  tick: number;
  from: string;
  to?: string;
  text: string;
}
export interface WorldEvent {
  id: string;
  tick: number;
  kind: string;
  text: string;
  citizenId?: string;
  targetId?: string;
  x?: number;
  y?: number;
  audience?: string[]; // absent is spectator-only unless separately projected by observation
}
export interface CitizenSighting extends Point {
  id: string;
  name: string;
  color: string;
  alive: boolean;
  health: number;
  activity: string;
}
export interface TileMemory extends Point {
  seenTick: number;
  citizens: CitizenSighting[];
  deposits: Deposit[];
  buildings: Building[];
  loot: Pick<Loot, 'id' | 'x' | 'y' | 'citizenName'>[];
}
export interface World {
  claims?: Record<string, TerritorialClaim>;
  alliances?: Record<string, Alliance>;
  schemaVersion: 1;
  runId: string;
  /** Absent in older checkpoints; recover the starting scenario from initialGold. */
  scenario?: 'village' | 'competition' | 'progression';
  seed: number;
  rngState: number;
  nextId: number;
  tick: number;
  width: number;
  height: number;
  /** Bounded spectator history; absent on historical saves until recording starts. */
  telemetry?: WorldTelemetry;
  /** Absent on historical saves: retain their original three-band geometry. */
  ringCount?: number;
  initialGold: number;
  citizens: Record<string, Citizen>;
  deposits: Record<string, Deposit>;
  buildings: Record<string, Building>;
  orders: Record<string, Order>;
  loot: Record<string, Loot>;
  messages: Message[];
  events: WorldEvent[];
  /** Consequential history survives mundane command throughput; still audience-filtered for observers. */
  significantEvents?: WorldEvent[];
}
export interface CommandResult {
  ok: boolean;
  code: string;
  message: string;
  /** Synchronous settlement only, not a promise that the remaining order will fill. */
  order?: {
    id: string;
    side: 'buy' | 'sell';
    item: string;
    requestedQuantity: number;
    filledQuantity: number;
    remainingQuantity: number;
    goldPaid: number;
    goldReceived: number;
  };
}
export interface CitizenObservation {
  /** Explicit public announcements, not private live positions or motives. */
  claims?: TerritorialClaim[];
  alliances?: Alliance[];
  tick: number;
  /** Public geometry, not visibility. Optional for older recorded observations. */
  mapSize?: { width: number; height: number; ringCount?: number };
  citizen: Citizen;
  ascii: string;
  entityIndex: string[];
  visible: TileMemory[];
  remembered: TileMemory[];
  markets: (Order & { building?: Building })[];
  messages: Message[];
  alerts: WorldEvent[];
}
export type PlannerMode = 'scripted' | 'live' | 'recorded';
export interface TurnRecord {
  policyOutcome?: 'changed' | 'continued';
  id: string;
  citizenId: string;
  tick: number;
  generation: number;
  status: 'thinking' | 'completed' | 'yielded' | 'interrupted' | 'error';
  stopReason?: string;
  reason: string;
  observation: string;
  calls: { command: Command; result: CommandResult }[];
  response?: string;
  error?: string;
  elapsedMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}
export interface BudgetLimits {
  maxRequests: number;
  maxTokens: number;
}
export interface BudgetBlock {
  reason: 'requests' | 'tokens';
  message: string;
  requestedTokens: number;
  remainingTokens: number;
}
export interface BudgetStatus {
  /** Optional for older snapshot fixtures; the runtime always supplies both token totals. */
  tokens?: number;
  maxTokens?: number;
  blocked?: BudgetBlock;
  requests: number;
  pending: number;
  spent: number;
  limit: number;
  unit: string;
}
export interface RuntimeStatus {
  planner?: {
    model: string;
    maxRequestsPerTurn: number;
    maxOutputTokens: number;
    maxConcurrent: number;
    reviewInterval: number;
    minRequestIntervalTicks: number;
    minRequestIntervalMs: number;
    maxRequestsPerHour: number;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    citizenTicks: number;
    requestsPer1000CitizenTicks: number;
  };
  running: boolean;
  speed: number;
  mode: PlannerMode;
  generation: number;
  state: 'ready' | 'reloading' | 'error';
  error?: string;
  thinking: string[];
}
export interface AppSnapshot {
  world: World;
  status: RuntimeStatus;
  turns: TurnRecord[];
  budget: BudgetStatus;
}
export type Control = {
  type: 'play' | 'pause' | 'step' | 'speed' | 'scenario' | 'mode' | 'checkpoint' | 'reset';
  ticks?: number;
  speed?: number;
  scenario?: string;
  mode?: PlannerMode;
  /** Founding population for an explicit scenario/reset, 1..250. */
  population?: number;
};
