// Shared data contracts. World data must survive a JSON round trip.
export type Tier = 1 | 2 | 3;
export type Resource = 'food' | 'wood' | 'fibre';
export type EquipmentKind = 'axe' | 'scythe' | 'knife' | 'sword';
export type BuildingKind = 'lumbermill' | 'spinning-wheel' | 'butchery' | 'wall';
export type ItemKey = string; // `${resource or equipment kind}:${tier}`
export type Inventory = Record<ItemKey, number>;
export interface Point {
  x: number;
  y: number;
}
export type Region = 'center' | 'ring1' | 'ring2';
export type QueueMode = 'replace' | 'append';
export type Command = (
  | { type: 'move'; x: number; y: number }
  | { type: 'harvest'; depositId: string }
  | { type: 'craft'; item: EquipmentKind; tier: Tier }
  | { type: 'equip'; item: ItemKey }
  | { type: 'unequip'; kind: EquipmentKind }
  | { type: 'build'; kind: BuildingKind; tier: Tier; x: number; y: number }
  | { type: 'refine'; buildingId: string; fromTier: 1 | 2 }
  | { type: 'attack'; targetId: string }
  | { type: 'loot'; lootId: string }
  | { type: 'cancel' }
  | { type: 'order'; side: 'buy' | 'sell'; item: ItemKey; quantity: number; price: number }
  | { type: 'cancel-order'; orderId: string }
  | { type: 'transfer'; citizenId: string; gold: number }
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
  id: string;
  name: string;
  color: string;
  personality: string;
  alive: boolean;
  health: number;
  fullness: number;
  gold: number;
  inventory: Inventory;
  equipment: Partial<Record<EquipmentKind, ItemKey>>;
  action: Action | null;
  queue: Command[];
  goals: string[];
  memories: Memory[];
  knowledge: Record<string, TileMemory>;
  lastResult: string;
  nextReviewTick: number;
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
  schemaVersion: 1;
  runId: string;
  seed: number;
  rngState: number;
  nextId: number;
  tick: number;
  width: number;
  height: number;
  initialGold: number;
  citizens: Record<string, Citizen>;
  deposits: Record<string, Deposit>;
  buildings: Record<string, Building>;
  orders: Record<string, Order>;
  loot: Record<string, Loot>;
  messages: Message[];
  events: WorldEvent[];
}
export interface CommandResult {
  ok: boolean;
  code: string;
  message: string;
}
export interface CitizenObservation {
  tick: number;
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
  id: string;
  citizenId: string;
  tick: number;
  generation: number;
  status: 'thinking' | 'completed' | 'interrupted' | 'error';
  reason: string;
  observation: string;
  calls: { command: Command; result: CommandResult }[];
  response?: string;
  error?: string;
  elapsedMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}
export interface BudgetStatus {
  requests: number;
  pending: number;
  spent: number;
  limit: number;
  unit: string;
}
export interface RuntimeStatus {
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
  type: 'play' | 'pause' | 'step' | 'speed' | 'scenario' | 'mode' | 'checkpoint';
  ticks?: number;
  speed?: number;
  scenario?: string;
  mode?: PlannerMode;
};
