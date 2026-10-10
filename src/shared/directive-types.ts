import type {
  Action,
  CommandResult,
  ToolKind,
  BuildingKind,
  Resource,
  Tier,
  Point,
} from './types.ts';
import type { PlanCondition } from './plan-types.ts';
import type { AutonomyPolicyPatch } from './autonomy-types.ts';

/** Inclusive bounds, bottom-left origin; union of rectangles, not ownership. */
export type WorkRect = [number, number, number, number];
type Work = { areas: WorkRect[]; maxTicks?: number; stopWhen?: PlanCondition };
type Production = Work & { quantity?: number };
export type Directive =
  | ({ type: 'gather'; resource: Resource; tier: Tier } & Production)
  | ({ type: 'operate'; buildingId: string; fromTier: Tier; direction?: 'up' | 'down' } & Production)
  /** Crafted tools are usable directly from carried inventory. */
  | ({ type: 'craft'; item: ToolKind; tier: Tier } & Production)
  | ({ type: 'build'; kind: BuildingKind; tier: Tier; x: number; y: number } & Work)
  | ({ type: 'reproduce'; partnerId: string } & Work)
  | ({ type: 'explore' } & Work)
  | { type: 'move'; x: number; y: number };
export interface StrategySpec {
  policy?: AutonomyPolicyPatch;
  mode: 'keep' | 'append' | 'replace';
  directives?: Directive[];
  reviewAfter?: number;
  memory?: string;
  goals?: string[];
  communications?: { text: string; to?: string }[];
}
export interface DirectiveReceipt {
  tick: number;
  strategyId: string;
  index: number;
  outcome: 'accepted' | 'completed' | 'stopped' | 'blocked' | 'cancelled';
  message: string;
}
export interface DirectiveState {
  id: string;
  approvedTick: number;
  directives: Directive[];
  index: number;
  status: 'active' | 'blocked' | 'completed' | 'stopped';
  reviewTick: number;
  startedTick?: number;
  progress: number;
  lastProgressTick: number;
  /** Explored destinations and exhausted dated sightings; bounded by map size. */
  attempted: string[];
  wakeTick?: number;
  pending?: {
    actionId: string;
    purpose: 'travel' | 'gather' | 'work' | 'explore';
    result?: CommandResult;
  };
  blockedReason?: string;
}
/** Exact paused physical work; reserved inputs remain held until resume/cancel/death. */
export interface EmergencyFeeding {
  startedTick: number;
  depositId: string;
  outsideAreas: boolean;
  stage: 'gather' | 'return';
  outcome?: string;
  suspendedAction?: Action;
  suspendedPosition?: Point;
}
