import { createPlanner, DEFAULT_ENDPOINT, DEFAULT_MODEL } from './planner.mjs';
import { createAgentPlanner } from './agent-planner.mjs';
import { createCodexTransport, CODEX_MODEL } from './codex-provider.mjs';

export function createRuntimePlanner({ budget, audit, env = process.env } = {}) {
  const provider = env.PROSPER_PROVIDER || 'ollama';
  if (!['ollama', 'openai-codex'].includes(provider)) throw new Error('PROSPER_PROVIDER must be ollama or openai-codex.');
  if (provider === 'openai-codex' && env.PROSPER_HARNESS === 'legacy') throw new Error('OpenAI Codex requires the semantic tool harness.');
  return (env.PROSPER_HARNESS === 'legacy' ? createPlanner : createAgentPlanner)({
    ...(provider === 'openai-codex' ? createCodexTransport() : { endpoint: env.OLLAMA_BASE_URL || DEFAULT_ENDPOINT }),
    model: env.PROSPER_MODEL || (provider === 'openai-codex' ? CODEX_MODEL : DEFAULT_MODEL),
    reasoningEffort: env.PROSPER_REASONING_EFFORT || undefined,
    maxConcurrentTurns: Number(env.PROSPER_CONCURRENCY || 6),
    minStartIntervalMs: Number(env.PROSPER_START_INTERVAL_MS || 1000),
    strategyReview: env.PROSPER_STRATEGY_REVIEW === '1', projectContinuity: env.PROSPER_PROJECT_CONTINUITY === '1', budget, audit,
  });
}
