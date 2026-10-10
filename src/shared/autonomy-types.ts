import type { Point, Resource, Tier } from './types.ts';
import type { WorkRect } from './directive-types.ts';

/** Compact, persistent instructions. The body executes these without model calls. */
export interface AutonomyPolicy {
  livelihood: Resource;
  targetTier: Tier;
  home?: Point;
  territory?: WorkRect;
  noGo?: WorkRect[];
  stance: 'cooperative' | 'assertive' | 'predatory';
  aggression: number;
  caution: number;
  foodReserveTicks: number;
  sellPrice: number;
  buyPrice: number;
  allies: string[];
  rivals: string[];
  reproduction: 'avoid' | 'open' | 'seek';
  partnerId?: string;
  /** Zero means exclusive access; otherwise access can be negotiated for gold. */
  accessPrice: number;
}
/** Null explicitly clears optional commitments; omission preserves them. */
export type AutonomyPolicyPatch=Omit<Partial<AutonomyPolicy>,'home'|'territory'|'partnerId'> & {
  home?:Point|null;
  territory?:WorkRect|null;
  partnerId?:string|null;
};
export interface CitizenTraits {
  aggression: number;
  sociability: number;
  ambition: number;
  caution: number;
  fertility: number;
  loyalty: number;
}
export interface Relationship {
  trust: number;
  grievance: number;
  respect: number;
  trades: number;
  trespasses: number;
  harm: number;
  lastTick: number;
}
export interface SocialEvidence {
  tick: number;
  kind: 'competition' | 'trespass' | 'attack' | 'trade' | 'help' | 'threat' | 'alliance' | 'family' | 'survival';
  otherId?: string;
  text: string;
  x?: number;
  y?: number;
}
export interface SocialSignal {
  from: string;
  tick: number;
  kind: 'alliance-offer' | 'family-offer' | 'family-accept' | 'family-ready' | 'family-decline' | 'access-demand' | 'access-grant';
  x?: number;
  y?: number;
  amount?: number;
  reason?: string;
}
export interface AutonomyState {
  source?: 'scripted' | 'live' | 'recorded';
  reviewedTick?: number;
  policyRevision?: number;
  claimSuppressed?: boolean;
  /** True only for a territory deliberately supplied in a policy update. */
  territoryExplicit?: boolean;
  policy: AutonomyPolicy;
  traits: CitizenTraits;
  relationships: Record<string, Relationship>;
  evidence: SocialEvidence[];
  evidenceOmitted?: number;
  intent: string;
  /** Deliberate controller pause, distinguished from failed or stalled work. */
  idleReason?: 'surplus';
  nextThinkTick: number;
  nextSocialTick: number;
  nextMarketTick: number;
  lastEventId: number;
  lastProgressTick: number;
  visited: Record<string, number>;
  /** Only actor-observed identities; does not expose opponents' inventories. */
  threatened: Record<string, { tick: number; reason: string; demand: number }>;
  permits: Record<string, number>;
  signals?: SocialSignal[];
  sentSignals?: Record<string,number>;
  beggedTick?: number;
  requestedPartnerId?: string;
  familyFoodTarget?: number;
  interruptedIntent?: string;
  productionGoal?: { item: 'axe' | 'scythe' | 'knife' | 'sword'; tier: Tier };
  meeting?: { partnerId: string; x: number; y: number; tick: number };
  combat?: { targetId: string; startedTick: number; lastContactTick: number; reason: string };
  project?: { kind: 'lumbermill' | 'spinning-wheel' | 'butchery'; tier: Tier; x: number; y: number };
}
export interface TerritorialClaim {
  /** Paid territorial access only; personal protection permits stay private. */
  accessPermits?: Record<string, number>;
  id: string;
  ownerId: string;
  areas: WorkRect;
  createdTick: number;
  expiresTick: number;
  accessPrice: number;
  /** A claim is an announced demand, never a magic movement restriction. */
  stance: 'open' | 'toll' | 'exclusive';
  resource: Resource;
}
export interface Alliance {
  id: string;
  name: string;
  members: string[];
  createdTick: number;
  lastActiveTick: number;
}
