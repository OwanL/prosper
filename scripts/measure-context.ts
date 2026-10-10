import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { observe } from '../src/world/observation.ts';
import { strategicContext, STRATEGIC_PROMPT_VERSION } from '../src/citizen/strategic-context.ts';
import { strategicTools } from '../src/citizen/strategic-tools.ts';
import { freshContext } from '../src/citizen/prompt.ts';
import { tools } from '../src/citizen/tools.ts';
import type { World } from '../src/shared/types.ts';

// Pure read-only cross-section. Serialized bytes are not measured model tokens.
const source = process.argv[2];
if (!source) throw new Error('Pass a retained world JSON snapshot path. No model is called.');
const raw = readFileSync(resolve(source));
const world: World = JSON.parse(raw.toString());
const samples = Object.values(world.citizens)
  .filter((c) => c.alive)
  .map((c) => {
    const observation = observe(world, c.id);
    const messages = strategicContext(observation);
    return {
      citizenId: c.id,
      compactBytes: Buffer.byteLength(
        JSON.stringify({
          model: 'qwen3.5:9b',
          reasoning_effort: 'none',
          max_tokens: 1200,
          stream: false,
          messages,
          tools: strategicTools,
        }),
      ),
      legacyBytes: Buffer.byteLength(
        JSON.stringify({
          model: 'deepseek-v4.1-flash:cloud',
          reasoning_effort: 'low',
          max_tokens: 40000,
          stream: false,
          messages: freshContext(observation),
          tools,
        }),
      ),
      omissions: JSON.parse(messages[1].content!).contextBudgetOmissions,
    };
  });
const percentile = (key: 'compactBytes' | 'legacyBytes', p: number) =>
  samples.map((s) => s[key]).sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1];
const report = {
  source: resolve(source),
  sha256: createHash('sha256').update(raw).digest('hex'),
  promptVersion: STRATEGIC_PROMPT_VERSION,
  tick: world.tick,
  population: samples.length,
  providerRequests: 0,
  actualProviderTokens: 0,
  compactP50: percentile('compactBytes', 0.5),
  compactP95: percentile('compactBytes', 0.95),
  compactMax: percentile('compactBytes', 1),
  legacyP50: percentile('legacyBytes', 0.5),
  legacyP95: percentile('legacyBytes', 0.95),
  samples,
};
const directory = resolve('.experiments', 'context-measurements');
mkdirSync(directory, { recursive: true });
const target = join(directory, `${basename(source, '.json')}-${STRATEGIC_PROMPT_VERSION}.json`);
writeFileSync(target, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, samples: samples.length, target }, null, 2));
