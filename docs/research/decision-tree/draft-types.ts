// Descriptive planning data transcribed from the Mermaid graphs, not executable
// mechanics or assertions about the implemented market.
import type { Tier } from '../../../src/shared/tiers.ts';

export type DecisionNode = { kind: 'decision'; label: string; yes: string; no: string };
// Compare available exact-tier inventory with that resource's building recipe cost.
export type BuildMaterialDecisionNode = DecisionNode & { requiredResource: 'wood' | 'fibre' };
export type ResourceBuildingRequest = { resource: ResourceRequest['kind']; tier: Tier };
export type StepNode = {
  kind: 'step';
  operation: 'entry' | 'calculateShortfall' | 'selectFundingCombination';
  label: string;
  next: string;
};
export type FundingNode = {
  kind: 'funding';
  action: 'cancelBuyOrders' | 'sellItems' | 'cancelNonFoodSellOrders';
  label: string;
  next: string;
};
export type FoodNode = { kind: 'food'; action: 'buyFood' | 'cancelFoodSellOrder'; label: string };
export type BooleanNode = { kind: 'boolean'; value: boolean };
export type ErrorNode = { kind: 'error'; label: string };
export type ResourceRequest = {
  kind: 'food' | 'fibre' | 'wood';
  tier: number;
  allowMarket: boolean;
};
export type ResourcePlanNode = {
  kind: 'resourcePlan';
  operation: 'enumerateKnownRoutes' | 'estimateAndSelectRoute';
  label: string;
  next: string;
};
export type PreparationNode = {
  kind: 'preparation';
  action: 'postBuyOrder' | 'moveToTarget' | 'preparePrerequisites' | 'fundPurchase';
  label: string;
  next: string;
};
export type ResourceNode = {
  kind: 'resource';
  action:
    | 'buyResource'
    | 'receiveBuyFill'
    | 'recoverRequestedSellEscrow'
    | 'harvestResource'
    | 'refineResource'
    | 'salvageResource'
    | 'combatTransfer'
    | 'receiveExternalTransfer';
  label: string;
};
export type DraftNode =
  | DecisionNode
  | BuildMaterialDecisionNode
  | StepNode
  | FundingNode
  | FoodNode
  | BooleanNode
  | ErrorNode
  | ResourcePlanNode
  | PreparationNode
  | ResourceNode;
export type DraftTree = {
  name: string;
  kind: 'condition' | 'foodAction' | 'resourceAction';
  document: string;
  entry: string;
  nodes: Record<string, DraftNode>;
};
