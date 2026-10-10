import type { Command, CommandResult, Inventory, Resource, Tier } from './types.ts';

/** Deliberately bounded plan vocabulary. Social/market/combat/joint actions retain command tools. */
export type PlanCommand = Extract<
  Command,
  { type: 'move' | 'harvest' | 'craft' | 'build' | 'refine' | 'loot' }
>;
export type PlanCondition =
  | { kind: 'food-runway-below'; ticks: number }
  | { kind: 'health-below'; health: number }
  | { kind: 'inventory-at-least'; item: string; quantity: number };
export type PlanStep = (
  | { type: 'command'; command: PlanCommand }
  | { type: 'gather'; resource: Resource; tier: Tier; targetQuantity?: number; maxTicks: number }
  | { type: 'wait'; ticks: number }
) & { stopWhen?: PlanCondition; onFailure?: 'review' | 'continue' };
export interface PlanSpec {
  steps: PlanStep[];
  mode: 'append' | 'replace';
}
export interface PlanReceipt {
  planId: string;
  step: number;
  tick: number;
  outcome: 'completed' | 'condition' | 'failed' | 'cancelled';
  message: string;
  state: {
    x: number;
    y: number;
    inventory: Inventory;
    fullness: number;
    health: number;
    gold: number;
  };
}
export interface PlanState extends PlanSpec {
  id: string;
  approvedTick: number;
  stepIndex: number;
  /** Starts after previously approved physical work finishes. */
  stepStartedTick?: number;
  pending?: { actionId: string; eventSequence: number; result?: CommandResult };
  /** A chosen dated destination, not remote tracking. */
  gatheringTargetId?: string;
  wakeTick?: number;
}
