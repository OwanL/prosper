import type { Command, ItemKey, Point, Resource, Tier } from './types.ts';

/** Provisional scales: 0..1; larger enterprise means investment, independence means own production. */
export interface Dispositions {
  ambition: number; morals: number; generosity: number; riskTolerance: number;
  patience: number; sociability: number; vengefulness: number; familyOrientation: number;
  enterprise: number; economicIndependence: number;
}
export const MIND_LIMITS = { memories: 64, tasks: 16, ancestry: 16, receipts: 128, trace: 128, ownedOrders: 8, evidence: 16 } as const;
export interface StructuredMemory {
  id: string; tick: number;
  kind: 'survival' | 'trade' | 'harm' | 'help' | 'family' | 'territory' | 'work';
  otherId?: string; location?: Point; text: string;
}
/** Net custody receipt, emitted once per recipient/item/settlement, never gross production. */
export interface DeliveryReceipt {
  id: string; settlementId: string; tick: number; citizenId: string; item: ItemKey;
  quantity: number; source: 'harvest' | 'tax' | 'market' | 'recovery' | 'gift' | 'refine' | 'estate';
  /** One receipt may be allocated to only one request; consumption does not erase delivery. */
  requestId?: string;
}
export interface ResourceRequest {
  id: string; resource: Resource; tier: Tier; quantity: number; allowMarket: boolean;
  purpose: string; urgency: 'routine' | 'urgent' | 'survival'; deadlineTick?: number;
}
export interface TreeTaskState {
  id: string; definitionId: string; parentId?: string; request: ResourceRequest;
  strategyId?: string; ancestry: string[]; phase: string;
  status: 'running' | 'succeeded' | 'failed'; startedTick: number; lastProgressTick: number;
  /** Exact running sum of the quantities of the allocated DeliveryReceipt ids below;
   * never clamped to the request and never derived from events, so taxed fractional
   * settlements are retained exactly. */
  delivered: number;
  /** DeliveryReceipt ids only: matching request/item, unique across all retained tasks. */
  receiptIds: string[];
  /** WorldEvent ids only (completion, trade, civic and family evidence) consumed by
   * this task, in a channel separate from receipts; optional on old checkpoints and
   * bounded by MIND_LIMITS.evidence. Referenced events may expire freely; ids stay
   * unique, never overlap DeliveryReceipt allocation, and are never required. */
  evidenceIds?: string[];
  /** Monotonic engine event-N high-water mark for aggregate trade consumption.
   * Diagnostic evidenceIds remain bounded; confirmed units live in accounting.units. */
  tradeEventCursor?: number;
  ownedOrderIds: string[]; actionId?: string;
  /** Nonspatial counters, exact and separate from grid coordinates. Optional for old saves. */
  accounting?: { units?: number; escrowQuantity?: number; goldBefore?: number; marked?: number; signBaseline?: number };
  targetId?: string; target?: Point; wakeTick?: number; reason?: string;
}
export interface TreeTraceEvent {
  tick: number; invocationId: string; definitionId: string; parentId?: string;
  transition: 'enter' | 'exclude' | 'select' | 'propose' | 'wait' | 'succeed' | 'fail' | 'interrupt';
  reason: string; command?: Command;
}
export interface CitizenMind {
  /** Provisional personal safety pull, not a plan; event cursor prevents retained-alert replay. */
  community?: { weight: number; tick: number; eventCursor: number };
  version: 1; dispositions: Dispositions; memories: StructuredMemory[]; memoriesOmitted: number;
  tasks: TreeTaskState[]; activeTaskId?: string; receipts: DeliveryReceipt[];
  trace: TreeTraceEvent[]; traceOmitted: number; nextDirectorTick: number; lastDirectorTick?: number;
}
export interface TreeStepResult {
  status: 'running' | 'succeeded' | 'failed'; reason: string;
  /** Proposal only; adapter commits at most one command on an idle decision boundary. */
  command?: Command; waiting?: 'action' | 'order' | 'prerequisite' | 'wake';
  failure?: 'excluded' | 'infeasible' | 'rejected' | 'invalidated' | 'no-progress';
}
