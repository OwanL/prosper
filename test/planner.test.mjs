import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, createWorld, planningContext } from '../lib/world.mjs';
import {
  createPlanner,
  DEFAULT_MODEL,
  parsePlanContent,
  PlannerError,
  PlanResponseError,
  SYSTEM_PROMPT,
} from '../lib/planner.mjs';

const plan = {
  thought: 'Gather food nearby.',
  goals: ['Keep the settlement fed'],
  memory: 'Crop-1 is east.',
  routine: { family: false },
  work: null,
  reviewAfter: 300,
  tasks: [{ type: 'wait', ticks: 2 }],
};

function response(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

test('the legacy planner also stops retired-model calls and preserves conservative failed usage accounting', async () => {
  const settlements = []; let calls = 0;
  const planner = createPlanner({ model: 'retired:cloud', budget: { reserve: () => 'reservation', settle: (...args) => settlements.push(args) },
    fetchImpl: async () => { calls++; return response({ error: 'private details' }, { ok: false, status: 410 }); } });
  const context = planningContext(createWorld(), 'citizen-1');
  await assert.rejects(planner.plan(context), error => error.httpStatus === 410 && error.retryable === false);
  await assert.rejects(planner.plan(context), /no longer available/);
  await assert.rejects(planner.check(), /no longer available/);
  assert.equal(calls, 1); assert.deepEqual(settlements, [['reservation', null]]);
});

test('parsePlanContent accepts plain and fenced JSON while reporting safe parse errors', () => {
  assert.deepEqual(parsePlanContent(JSON.stringify(plan)), plan);
  assert.deepEqual(parsePlanContent(`\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`\n`), plan);
  assert.throws(() => parsePlanContent('  '), (error) => {
    assert.ok(error instanceof PlannerError);
    assert.match(error.message, /no plan/);
    return true;
  });
  assert.throws(() => parsePlanContent('{not json}'), (error) => {
    assert.ok(error instanceof PlannerError);
    assert.match(error.message, /invalid JSON/);
    assert.doesNotMatch(error.message, /not json/);
    return true;
  });
});

test('planner uses the expected JSON API protocol and bounds observations sent upstream', async () => {
  const calls = [];
  const planner = createPlanner({
    endpoint: 'http://ollama.test/v1',
    model: 'test-model',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/models')) {
        return response({ data: [{ id: 'test-model' }] });
      }
      return response({
        choices: [{ finish_reason: 'stop', message: { content: `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`` } }],
        usage: { total_tokens: 37 },
      });
    },
  });

  await planner.check();
  assert.equal(calls[0].url, 'http://ollama.test/v1/models');
  assert.equal(calls[0].options.method, undefined);
  assert.ok(calls[0].options.signal instanceof AbortSignal);

  const context = {
    citizen: {
      id: 'citizen-1',
      memories: Array.from({ length: 7 }, (_, index) => `memory-${index}`),
    },
    nodes: [{ id: 'crop-1' }],
    board: Array.from({ length: 23 }, (_, index) => ({ text: `board-${index}` })),
    events: Array.from({ length: 40 }, (_, index) => ({
      citizenId: index % 2 === 1 ? 'citizen-1' : 'citizen-2',
      tick: index,
      text: `event-${index}-${'x'.repeat(200)}`,
    })),
  };
  const result = await planner.plan(context);
  assert.deepEqual(result, { plan, tokens: 37 });
  assert.equal(calls[1].url, 'http://ollama.test/v1/chat/completions');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  assert.ok(calls[1].options.signal instanceof AbortSignal);

  const request = JSON.parse(calls[1].options.body);
  assert.equal(request.model, 'test-model');
  assert.equal(request.stream, false);
  assert.equal(request.max_tokens, 8192);
  assert.equal(request.reasoning_effort, 'low');
  assert.deepEqual(request.response_format, { type: 'json_object' });
  assert.equal(request.messages[0].role, 'system');
  const observation = JSON.parse(request.messages[1].content);
  assert.deepEqual(observation.citizen, {
    ...context.citizen,
    memories: ['memory-4', 'memory-5', 'memory-6'],
    work: null,
  });
  assert.equal(Object.hasOwn(observation, 'nodes'), false, 'global live deposits are not sent to the model');
  assert.equal(request.messages[0].content, SYSTEM_PROMPT);
  assert.equal(observation.board.length, 4);
  assert.equal(observation.board[0].text, 'board-19');
  assert.equal(observation.board.at(-1).text, 'board-22');
  assert.deepEqual(observation.events.map((event) => event.tick), [33, 35, 37, 39]);
  assert.ok(observation.events.every((event) => event.text.length === 180));
  assert.ok(observation.events[0].text.startsWith('event-33-'));
  assert.equal(context.board.length, 23, 'planning does not truncate the caller context');
});

test('planner allowlists private context and projects contacts, mail, offers, and task history', async () => {
  let body;
  const planner = createPlanner({
    fetchImpl: async (_url, options) => {
      body = options.body;
      return response({ choices: [{ message: { content: JSON.stringify(plan) } }] });
    },
  });
  const context = {
    tick: 23, width: 30, height: 12, rules: { secret: 'rules-secret' },
    stats: { secret: 'stats-secret' }, nodes: [{ secret: 'live-node-secret' }],
    economy: { secret: 'economy-secret' }, accidental: 'context-secret',
    citizen: {
      id: 'citizen-1', name: 'Mira', x: 2, y: 3, food: 4, wood: 5, hunger: 20, energy: 80, health: 100,
      tool: true, weapon: false, shoes: true, familyReady: false, reproduceAfter: 0,
      personality: 'curious', aspirations: ['Find a friend'], goals: ['Gather food'], memories: ['saw crop'],
      routine: { food: 4, wood: 10, family: false, hidden: 'routine-secret' },
      order: { type: 'gather', resource: 'food', amount: 2, target: 'crop-1', camp: false, secret: 'order-secret' },
      tasks: [{ type: 'wait', ticks: 2, secret: 'task-secret' }],
      relationships: { 'citizen-2': 12 }, parents: ['citizen-3'],
      children: [{ id: 'citizen-4', name: 'Sprig', adult: false, food: 99, hunger: 0, secret: 'child-secret' }],
      exploredTiles: 9, resourceHistory: [{ nodeId: 'crop-1', visits: 1, emptyVisits: 0, secret: 'history-secret' }],
      knowledge: { nodes: { 'secret-node': { id: 'secret-node' } }, private: 'knowledge-secret' },
      privateInventory: 'self-secret', privateField: 'citizen-secret', thought: 'thought-secret',
    },
    neighbors: [{ id: 'citizen-2', name: 'Oren', adult: true, x: 21, y: 8, food: 999, familyReady: true, private: 'neighbor-secret' }],
    contacts: [{
      id: 'citizen-2', name: 'Oren', adult: true, x: 5, y: 4, observedAt: 20,
      source: 'reported', reportedBy: 'citizen-3', food: 999, familyReady: true, private: 'contact-secret',
    }],
    deposits: [{
      id: 'crop-1', kind: 'crop', x: 4, y: 3, stock: 1, capacity: 1, yield: 1, regrowTicks: 99,
      observedAt: 21, source: 'seen', reportedBy: 'citizen-2', liveStock: 500, private: 'deposit-secret',
    }],
    offers: [{
      id: 'offer-1', makerId: 'citizen-2', give: 'wood', giveAmount: 2, want: 'food', wantAmount: 1,
      recipient: null, createdAt: 10, expiresAt: 250, status: 'open', makerInventory: 'offer-secret',
    }],
    inbox: [{
      id: 'message-1', senderId: 'citizen-2', recipientId: 'citizen-1', tick: 22,
      text: 'Meet me?', location: { x: 6, y: 3, hidden: 'location-secret' }, private: 'message-secret',
    }],
    outbox: [{ id: 'message-2', senderId: 'citizen-1', recipientId: 'citizen-2', tick: 22, text: 'Maybe', private: 'outbox-secret' }],
    board: [{ id: 'post-1', tick: 22, citizenId: 'citizen-2', name: 'Oren', text: 'Public', private: 'board-secret' }],
    events: [
      { tick: 22, citizenId: 'citizen-1', text: 'Mine', private: 'event-secret' },
      { tick: 22, citizenId: 'citizen-2', text: 'Not mine', private: 'other-event-secret' },
    ],
  };

  await planner.plan(context);
  const observation = JSON.parse(JSON.parse(body).messages[1].content);
  assert.deepEqual(Object.keys(observation).sort(), [
    'board', 'citizen', 'contacts', 'deposits', 'events', 'height', 'inbox', 'incidents', 'knownBuildings', 'neighbors', 'offers', 'outbox', 'tick', 'width',
  ]);
  assert.equal(observation.citizen.knowledge, undefined);
  assert.equal(observation.citizen.privateInventory, undefined);
  assert.equal(observation.citizen.thought, undefined);
  assert.deepEqual(observation.neighbors, [{ id: 'citizen-2', name: 'Oren', adult: true }]);
  assert.deepEqual(observation.contacts, [{
    id: 'citizen-2', name: 'Oren', adult: true, x: 5, y: 4, observedAt: 20,
    source: 'reported', reportedBy: 'citizen-3',
  }]);
  assert.deepEqual(observation.citizen.children, [{ id: 'citizen-4', name: 'Sprig', adult: false }]);
  assert.deepEqual(observation.citizen.order, {
    type: 'gather', resource: 'food', amount: 2, target: 'crop-1', camp: false,
  });
  assert.equal(observation.inbox[0].location.hidden, undefined);
  assert.equal(observation.offers[0].makerInventory, undefined);
  assert.equal(observation.events.length, 1);
  assert.equal(observation.events[0].text, 'Mine');
  assert.doesNotMatch(JSON.stringify(observation), /(?:secret|999|liveStock|500)/);
});

test('planner includes durable aspirations in an offline-built prompt without checking or calling a model', async () => {
  const requests = [];
  const aspirations = ['Become a respected healer', 'Keep the river clean'];
  const planner = createPlanner({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response({ choices: [{ message: { content: JSON.stringify(plan) } }] });
    },
  });

  await planner.plan({
    citizen: { id: 'citizen-1', aspirations, goals: ['Gather food nearby'] },
    board: [], events: [],
  });

  assert.equal(requests.length, 1, 'the mocked transport handles planning; no model check or external call is made');
  assert.ok(requests[0].url.endsWith('/chat/completions'));
  const request = JSON.parse(requests[0].options.body);
  const observation = JSON.parse(request.messages[1].content);
  assert.deepEqual(observation.citizen.aspirations, aspirations);
});

test('planner normalizes missing consent metadata and ignores extra root metadata', async () => {
  const raw = {
    thought: 'Continue.',
    goals: ['Keep a reserve'],
    memory: '',
    routine: { food: 6, wood: 14 },
    reviewAfter: 300,
    tasks: [{ type: 'wait', ticks: 5 }],
    modelMetadata: { untrusted: true },
  };
  let body;
  const planner = createPlanner({
    fetchImpl: async (_url, options) => {
      body = options.body;
      return response({ choices: [{ message: { content: JSON.stringify(raw) } }] });
    },
  });
  const context = {
    citizen: { id: 'citizen-1', familyReady: true, routine: { food: 4, wood: 10 } },
    board: [], events: [],
    nodes: [{ id: 'hidden-crop', stock: 1, regrowIn: 0 }],
  };

  const result = await planner.plan(context);
  assert.deepEqual(result.plan, {
    thought: 'Continue.',
    goals: ['Keep a reserve'],
    memory: '',
    routine: { family: true },
    work: null,
    reviewAfter: 300,
    tasks: [{ type: 'wait', ticks: 5 }],
  });
  const observation = JSON.parse(JSON.parse(body).messages[1].content);
  assert.equal(observation.citizen.routine, undefined, 'legacy flags are not model guidance');
  assert.equal(Object.hasOwn(observation, 'nodes'), false);
});

test('planner admits work-only and deliberate pause plans directly to the world without extra calls', async () => {
  for (const work of [{ type: 'explore' }, null]) {
    const world = createWorld();
    const citizen = world.citizens[0];
    const calls = [];
    const raw = { ...plan, work, tasks: [], reviewAfter: 180 };
    const planner = createPlanner({
      budget: {
        reserve: () => { calls.push('reserve'); return 'reservation-1'; },
        settle: () => calls.push('settle'),
      },
      fetchImpl: async () => {
        calls.push('fetch');
        return response({ choices: [{ message: { content: JSON.stringify(raw) } }] });
      },
    });
    const result = await planner.plan(planningContext(world, citizen.id));
    assert.deepEqual(result.plan, raw);
    applyPlan(world, citizen.id, result.plan);
    assert.deepEqual(citizen.work, work);
    assert.deepEqual(citizen.tasks, []);
    assert.equal(citizen.order, null, 'admission invents no order');
    assert.equal(citizen.reviewAt, world.tick + 180);
    assert.deepEqual(calls, ['reserve', 'fetch', 'settle']);
  }
});

test('planner sanitizes upstream HTTP, transport, and malformed-content errors', async () => {
  const privateDetail = 'proxy-account-secret-should-not-escape';
  const httpPlanner = createPlanner({
    fetchImpl: async () => response({ detail: privateDetail }, { ok: false, status: 502 }),
  });
  await assert.rejects(httpPlanner.plan({ board: [], events: [] }), (error) => {
    assert.ok(error instanceof PlannerError);
    assert.match(error.message, /HTTP 502/);
    assert.doesNotMatch(error.message, /proxy-account-secret/);
    return true;
  });

  const networkPlanner = createPlanner({
    fetchImpl: async () => { throw new Error(privateDetail); },
  });
  await assert.rejects(networkPlanner.plan({ board: [], events: [] }), (error) => {
    assert.ok(error instanceof PlannerError);
    assert.match(error.message, /Cannot reach Ollama/);
    assert.doesNotMatch(error.message, /proxy-account-secret/);
    return true;
  });

  const malformedPlanner = createPlanner({
    fetchImpl: async () => response({ choices: [{ message: { content: '{secret malformed response}' } }] }),
  });
  await assert.rejects(malformedPlanner.plan({ board: [], events: [] }), (error) => {
    assert.ok(error instanceof PlannerError);
    assert.match(error.message, /invalid JSON/);
    assert.doesNotMatch(error.message, /secret malformed/);
    return true;
  });
});

test('planner reserves budget before the network and skips fetch when reservation is denied', async () => {
  const calls = [];
  const budget = {
    reserve: (...bounds) => {
      calls.push(['reserve', ...bounds]);
      return 'reservation-1';
    },
    settle: (...args) => calls.push(['settle', ...args]),
  };
  const planner = createPlanner({
    budget,
    fetchImpl: async (_url, options) => {
      calls.push(['fetch', options]);
      return response({
        choices: [{ message: { content: JSON.stringify(plan) } }],
        usage: { prompt_tokens: 21, completion_tokens: 8 },
      });
    },
  });
  await planner.plan({ citizen: { id: 'citizen-1' }, board: [], events: [] });

  assert.deepEqual(calls.map(([kind]) => kind), ['reserve', 'fetch', 'settle']);
  const request = JSON.parse(calls[1][1].body);
  const promptBytes = Buffer.byteLength(JSON.stringify(request.messages), 'utf8');
  assert.ok(promptBytes <= 12_000);
  assert.deepEqual(calls[0], ['reserve', promptBytes + 1024, 8192]);
  assert.deepEqual(calls[2], ['settle', 'reservation-1', { inputTokens: 21, outputTokens: 8 }]);

  let deniedFetches = 0;
  let reserveAttempts = 0;
  const deniedPlanner = createPlanner({
    budget: {
      reserve: () => {
        reserveAttempts += 1;
        throw new Error('limit reached');
      },
      settle: () => assert.fail('a denied reservation cannot be settled'),
    },
    fetchImpl: async () => {
      deniedFetches += 1;
      return response({});
    },
  });
  await assert.rejects(deniedPlanner.plan({ board: [], events: [] }), (error) => {
    assert.ok(error instanceof PlannerError);
    assert.match(error.message, /Budget stopped planning: limit reached/);
    return true;
  });
  assert.equal(reserveAttempts, 1);
  assert.equal(deniedFetches, 0);
});

test('actual usage settles the reservation even when the returned plan is invalid JSON', async () => {
  const settlements = [];
  const planner = createPlanner({
    budget: {
      reserve: () => 'reservation-1',
      settle: (...args) => settlements.push(args),
    },
    fetchImpl: async () => response({
      choices: [{ message: { content: '{invalid}' } }],
      usage: { prompt_tokens: 31, completion_tokens: 12 },
    }),
  });

  await assert.rejects(planner.plan({ board: [], events: [] }), /invalid JSON/);
  assert.deepEqual(settlements, [[
    'reservation-1',
    { inputTokens: 31, outputTokens: 12 },
  ]]);
});

test('unknown actions reject as billed PlanResponseError without retrying', async () => {
  const settlements = [];
  let fetches = 0;
  const planner = createPlanner({
    budget: {
      reserve: () => 'reservation-1',
      settle: (...args) => settlements.push(args),
    },
    fetchImpl: async () => {
      fetches += 1;
      return response({
        choices: [{ message: { content: JSON.stringify({ ...plan, tasks: [{ type: 'teleport', x: 1, y: 1 }] }) } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      });
    },
  });
  await assert.rejects(planner.plan({ citizen: { id: 'citizen-1' }, board: [], events: [] }), (error) => {
    assert.ok(error instanceof PlanResponseError);
    assert.match(error.message, /unknown task type/);
    return true;
  });
  assert.equal(fetches, 1);
  assert.deepEqual(settlements, [['reservation-1', { inputTokens: 12, outputTokens: 4 }]]);
});

test('transport errors, cancellation, and absent usage consume their reservation uncertainly', async () => {
  const cases = [
    {
      name: 'transport failure',
      fetchImpl: async () => { throw new Error('private transport detail'); },
      expectedError: /Cannot reach Ollama/,
      usage: null,
    },
    {
      name: 'cancellation',
      makeFetch: (controller) => async () => {
        controller.abort();
        throw new Error('aborted');
      },
      expectedError: /Planning cancelled/,
      usage: null,
    },
    {
      name: 'absent usage',
      fetchImpl: async () => response({ choices: [{ message: { content: JSON.stringify(plan) } }] }),
      expectedError: null,
      usage: { inputTokens: undefined, outputTokens: undefined },
    },
  ];

  for (const scenario of cases) {
    const controller = new AbortController();
    let pending = false;
    let uncertain = false;
    let settlementCount = 0;
    const budget = {
      reserve: () => {
        pending = true;
        return scenario.name;
      },
      settle: (id, usage) => {
        assert.equal(id, scenario.name);
        assert.equal(pending, true, 'settlement consumes the outstanding reservation');
        pending = false;
        settlementCount += 1;
        uncertain = usage == null || !Number.isSafeInteger(usage.inputTokens)
          || !Number.isSafeInteger(usage.outputTokens);
        assert.deepEqual(usage, scenario.usage);
      },
    };
    const planner = createPlanner({ budget, fetchImpl: scenario.makeFetch?.(controller) ?? scenario.fetchImpl });
    const request = planner.plan({ board: [], events: [] }, controller.signal);
    if (scenario.expectedError) await assert.rejects(request, scenario.expectedError, scenario.name);
    else await request;
    assert.equal(pending, false, `${scenario.name} leaves no pending reservation`);
    assert.equal(uncertain, true, `${scenario.name} retains the reservation as uncertain`);
    assert.equal(settlementCount, 1, `${scenario.name} settles exactly once`);
  }
});

test('oversized optional narrative is trimmed before the small-request limit is enforced', async () => {
  let requestBody;
  const planner = createPlanner({
    fetchImpl: async (_url, options) => {
      requestBody = options.body;
      return response({ choices: [{ message: { content: JSON.stringify(plan) } }] });
    },
  });
  const context = {
    citizen: {
      id: 'citizen-1',
      thought: 't'.repeat(3_000),
      memories: Array.from({ length: 6 }, (_, index) => `memory-${index}`),
    },
    board: Array.from({ length: 4 }, (_, index) => ({ text: `board-${index}-${'b'.repeat(2_200)}` })),
    events: Array.from({ length: 4 }, (_, index) => ({
      citizenId: 'citizen-1', tick: index, text: `event-${index}-${'e'.repeat(1_200)}`,
    })),
  };

  await planner.plan(context);
  const request = JSON.parse(requestBody);
  const promptBytes = Buffer.byteLength(JSON.stringify(request.messages), 'utf8');
  assert.ok(promptBytes <= 12_000);
  const observation = JSON.parse(request.messages[1].content);
  assert.equal(observation.board.at(-1).text.slice(0, 7), 'board-3');
  assert.ok(observation.board.length >= 1 && observation.board.length <= 2);
  assert.equal(observation.events.at(-1).tick, 3);
  assert.ok(observation.events.length >= 1 && observation.events.length <= 2);
  assert.deepEqual(observation.citizen.memories, ['memory-5']);
  assert.equal(Object.hasOwn(observation.citizen, 'thought'), false);
  assert.equal(context.board.length, 4, 'trimming does not mutate caller observations');
  assert.equal(context.citizen.thought.length, 3_000);
});

test('an oversized prompt is rejected before reserving or calling the network', async () => {
  let reserveAttempts = 0;
  let fetchAttempts = 0;
  const planner = createPlanner({
    budget: {
      reserve: () => { reserveAttempts += 1; return 'reservation-1'; },
      settle: () => assert.fail('an oversized prompt cannot have a reservation'),
    },
    fetchImpl: async () => { fetchAttempts += 1; return response({}); },
  });

  await assert.rejects(planner.plan({
    citizen: { id: 'citizen-1' },
    board: [{ text: 'x'.repeat(13_000) }],
    events: [],
  }), (error) => {
    assert.ok(error instanceof PlannerError);
    assert.match(error.message, /small-request limit/);
    assert.match(error.message, /No request was sent/);
    return true;
  });
  assert.equal(reserveAttempts, 0);
  assert.equal(fetchAttempts, 0);
});

test('planner drops third-party mail before slicing so only self-addressed messages are sent', async () => {
  let body;
  const planner = createPlanner({
    fetchImpl: async (_url, options) => {
      body = options.body;
      return response({ choices: [{ message: { content: JSON.stringify(plan) } }] });
    },
  });
  const forwarded = (index, senderId = 'citizen-2') => ({
    id: `forwarded-${index}`, senderId, recipientId: 'citizen-3',
    tick: index, text: `third-party-secret-${index}`,
  });
  const context = {
    citizen: { id: 'citizen-1' },
    // Self mail is the first entry; a slice before the privacy filter would
    // drop it, so this pins filter-before-slice ordering.
    inbox: [
      { id: 'self-in', senderId: 'citizen-2', recipientId: 'citizen-1', tick: 1, text: 'Meet at crop-1?' },
      ...Array.from({ length: 9 }, (_, index) => forwarded(index)),
      { id: 'stray', senderId: 'citizen-1' }, // unaddressed mail is not automatically self mail
    ],
    outbox: [
      { id: 'self-out', senderId: 'citizen-1', recipientId: 'citizen-2', tick: 2, text: 'On my way.' },
      ...Array.from({ length: 9 }, (_, index) => forwarded(9 + index, 'citizen-3')),
    ],
    board: [], events: [],
  };

  await planner.plan(context);
  let request = JSON.parse(body);
  let observation = JSON.parse(request.messages[1].content);
  assert.deepEqual(observation.inbox, [
    { id: 'self-in', senderId: 'citizen-2', recipientId: 'citizen-1', tick: 1, text: 'Meet at crop-1?' },
  ]);
  assert.deepEqual(observation.outbox, [
    { id: 'self-out', senderId: 'citizen-1', recipientId: 'citizen-2', tick: 2, text: 'On my way.' },
  ]);
  assert.doesNotMatch(body, /third-party-secret/);

  // A fully overshared context keeps no foreign mail at all.
  await planner.plan({
    citizen: { id: 'citizen-1' },
    inbox: [forwarded(30)],
    outbox: [forwarded(40)],
    board: [], events: [],
  });
  request = JSON.parse(body);
  observation = JSON.parse(request.messages[1].content);
  assert.deepEqual(observation.inbox, []);
  assert.deepEqual(observation.outbox, []);
  assert.doesNotMatch(body, /third-party-secret/);
});

function endgameContext() {
  const names = ['Mira', 'Oren', 'Lio', 'Sela', 'Sprig 1', 'Sprig 2', 'Sprig 3', 'Sprig 4', 'Sprig 5', 'Sprig 6', 'Sprig 7', 'Sprig 8'];
  const citizens = names.map((name, index) => ({ id: `citizen-${index + 1}`, name, adult: index < 6 }));
  const deposits = [
    // Mirrors planningContext's real deposit shape: last-seen snapshot fields only.
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `crop-${index + 1}`, kind: 'crop', x: (index * 5) % 16, y: index % 10, stock: index % 3,
      observedAt: 66000 - (index * 7) % 500,
      source: index % 4 === 3 ? 'report' : 'seen', ...(index % 4 === 3 ? { reportedBy: 'citizen-2' } : {}),
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `tree-${index + 1}`, kind: 'tree', x: (index * 7) % 16, y: (index * 3) % 10, stock: 4,
      observedAt: 65900 - index, source: 'seen',
    })),
  ];
  const contacts = citizens.map(({ id, name, adult }, index) => ({
    id, name, adult, x: (index * 2) % 16, y: index % 10, observedAt: 66000 - index * 40,
    source: index % 3 ? 'report' : 'seen', ...(index % 3 ? { reportedBy: 'citizen-3' } : {}),
  }));
  const mailText = 'Meet me by tree-4 at tick 66100 so we can trade ten wood for four food before the crops regrow; bring shoes if the ridge path stays crowded with foragers today; bring the spare tools too, please.';
  const message = (id, senderId, recipientId, tick) => ({ id, senderId, recipientId, tick, text: mailText });
  const citizen = {
    id: 'citizen-1', name: 'Mira', x: 2, y: 2, food: 4, wood: 12, hunger: 55, energy: 78, health: 100,
    tool: true, weapon: false, shoes: true, familyReady: false, reproduceAfter: 0,
    personality: 'curious, sociable, family-minded',
    aspirations: ['Build a food reserve', 'Consider a family if sustainable', 'Trade wood for food'],
    goals: ['Keep a food reserve', 'Deliver wood to Oren', 'Watch the east crops'],
    memories: ['Traded wood for food with Oren near crop-6', 'Crop-2 was empty again at tick 65000', 'Sela asked about meeting near tree-4'],
    routine: { food: 4, wood: 10, family: false },
    order: { type: 'gather', resource: 'food', amount: 6, target: 'crop-2', camp: false },
    tasks: [{ type: 'gather', resource: 'wood', amount: 10 }, { type: 'move', x: 6, y: 2 }, { type: 'craft', item: 'tool' }],
    relationships: { 'citizen-2': 2, 'citizen-3': 1 },
    parents: [],
    children: [{ id: 'citizen-5', name: 'Sprig 1', adult: false }],
    exploredTiles: 118,
    resourceHistory: deposits.slice(0, 2).map(({ id }, index) => ({
      nodeId: id, visits: 3 - (index % 3), emptyVisits: index, lostRaces: index % 2,
      harvested: 12 - index, waitTicks: index * 7, lastOutcomeAt: 66000 - index,
    })),
  };
  return {
    tick: 66000, width: 16, height: 10, citizen,
    neighbors: citizens.slice(1), contacts, deposits,
    offers: [], // an ordinary endgame review snapshot with no open offers for this citizen
    inbox: Array.from({ length: 4 }, (_, index) => message(`message-${index + 1}`, 'citizen-2', 'citizen-1', 65997 + index)),
    outbox: Array.from({ length: 4 }, (_, index) => message(`message-${index + 10}`, 'citizen-1', `citizen-${index + 2}`, 65897 + index)),
    board: Array.from({ length: 4 }, (_, index) => ({
      id: `message-${index + 30}`, tick: 66000 - index, citizenId: `citizen-${index + 2}`, name: names[index + 1],
      text: `Fresh stock at crop-${index + 4}; trade wood for food.`,
    })),
    events: Array.from({ length: 4 }, (_, index) => ({
      tick: 66000 - index, citizenId: 'citizen-1',
      text: `Gathered wood at tree-${index + 1}; crop-${index + 2} was still empty.`,
    })),
  };
}

test('a dense social endgame snapshot fits by omitting bounded older observations only', async () => {
  const calls = [];
  const planner = createPlanner({
    fetchImpl: async (_url, options) => {
      calls.push(options.body);
      return response({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }] });
    },
  });
  const context = endgameContext();
  const paragraph = (subject, length) => `${subject} `.repeat(Math.ceil(length / (subject.length + 1))).slice(0, length);
  context.citizen.order.target = 'crop-1';
  context.citizen.personality = paragraph('curious sociable patient neighbor who values trust and shared plans', 250);
  context.citizen.goals = [
    paragraph('Keep food available for the settlement while respecting each neighbor’s independent choices', 100),
    paragraph('Coordinate with people who choose to share plans without assuming private needs or consent', 100),
    paragraph('Remember that distant reports can be stale and ask before relying on another person’s location', 100),
  ];
  context.citizen.aspirations = [
    paragraph('Build a steady food reserve so everyone can make their own plans through difficult seasons', 100),
    paragraph('Maintain warm voluntary friendships and share useful knowledge without demanding agreement', 100),
    paragraph('Explore carefully while treating every unseen place and private inventory as unknown', 100),
  ];
  context.citizen.memories = [
    paragraph('Oren once reported a crop that had already been harvested by the time I arrived', 160),
    paragraph('Sela asked whether I wanted to meet, but we had not agreed on a time or place', 160),
    paragraph('A kind message helped us coordinate a trade while leaving both of us free to decline', 159),
  ];
  context.citizen.resourceHistory = Array.from({ length: 6 }, (_, index) => ({
    nodeId: `crop-${index + 1}`, visits: index + 1, emptyVisits: index % 3,
    lostRaces: index % 2, harvested: index * 2, waitTicks: index * 5, lastOutcomeAt: 65900 - index,
  }));
  context.deposits[0].observedAt = 65000; // The active target is old, but still known.
  context.inbox = context.inbox.map((message, index) => ({
    ...message,
    text: paragraph(`Oren’s thoughtful note ${index + 1}: I can meet near the old path if you still want to trade, but no pressure`, 180),
  }));
  context.outbox = context.outbox.map((message, index) => ({
    ...message,
    text: paragraph(`My reply ${index + 1}: thank you for sharing the update; I will check my own notes and let you decide what works`, 200),
  }));
  context.board = context.board.map((post, index) => ({
    ...post, text: paragraph(`A neighbor shared a considerate update ${index + 1}; reports describe last-seen stock, not a promise`, 140),
  }));
  context.events = context.events.map((event, index) => ({
    ...event, text: paragraph(`I gathered what was available ${index + 1}; my observation may be old by another visit`, 140),
  }));
  context.offers = [
    { id: 'offer-own', makerId: 'citizen-1', give: 'wood', giveAmount: 10, want: 'food', wantAmount: 4, recipient: null, createdAt: 65800, expiresAt: 66040, status: 'open' },
    { id: 'offer-neighbor', makerId: 'citizen-2', give: 'food', giveAmount: 4, want: 'wood', wantAmount: 8, recipient: null, createdAt: 65990, expiresAt: 66230, status: 'open' },
  ];

  await planner.plan(context);
  assert.equal(calls.length, 1, 'bounded fitting makes one request without a model retry');
  const request = JSON.parse(calls[0]);
  const requestBytes = Buffer.byteLength(calls[0], 'utf8');
  assert.ok(Buffer.byteLength(JSON.stringify(request.messages), 'utf8') <= 12_000);
  const observation = JSON.parse(request.messages[1].content);
  assert.ok(Buffer.byteLength(JSON.stringify(request.messages), 'utf8') <= 12_000);
  assert.equal(observation.board.length, 1);
  assert.equal(observation.events.length, 1);
  assert.deepEqual(observation.outbox, []);
  assert.ok(observation.citizen.resourceHistory.length <= 2);
  assert.deepEqual(observation.offers.map((offer) => offer.id), ['offer-own', 'offer-neighbor']);
  assert.ok(observation.deposits.length <= 12);
  assert.ok(observation.deposits.some((deposit) => deposit.id === 'crop-1'), 'the known active gather target survives even when old');
  assert.ok(observation.deposits.every((deposit) => context.deposits.some((original) => original.id === deposit.id)), 'compaction only omits actual records');
  assert.deepEqual(observation.inbox.map((message) => message.id), ['message-3', 'message-4']);
  assert.ok(observation.contacts.length <= 6);
  assert.deepEqual(observation.citizen.goals, context.citizen.goals);
  assert.deepEqual(observation.citizen.aspirations, context.citizen.aspirations);
  assert.match(SYSTEM_PROMPT, /unknown\/omitted does not mean empty/);
  assert.match(SYSTEM_PROMPT, /Use supplied IDs\/mechanics/);
  assert.doesNotMatch(request.messages[1].content, /placeholder|redacted|unknown is empty/i);

  // The optional offer cap keeps the planner's own offer first, then the three newest others.
  context.citizen.goals = context.citizen.goals.map((goal) => goal.slice(0, 50));
  context.citizen.aspirations = context.citizen.aspirations.map((aspiration) => aspiration.slice(0, 50));
  context.offers = [
    { ...context.offers[0] },
    ...Array.from({ length: 5 }, (_, index) => ({
      ...context.offers[1], id: `offer-${index + 1}`, makerId: `citizen-${index + 2}`,
      createdAt: 65950 + index, expiresAt: 66190 + index,
    })),
  ];
  await planner.plan(context);
  assert.equal(calls.length, 2);
  const offerObservation = JSON.parse(JSON.parse(calls[1]).messages[1].content);
  assert.deepEqual(offerObservation.offers.map((offer) => offer.id), [
    'offer-own', 'offer-5', 'offer-4', 'offer-3',
  ]);
});

test('a large endgame world fits the small-request limit through the documented fallback chain', async () => {
  const calls = [];
  const planner = createPlanner({
    fetchImpl: async (_url, options) => {
      // MAX_PROMPT_BYTES bounds messages, not the HTTP envelope's model/settings.
      const bytes = Buffer.byteLength(JSON.stringify(JSON.parse(options.body).messages), 'utf8');
      calls.push({ bytes, body: options.body });
      if (bytes > 12_000) throw new Error(`oversized outbound prompt: ${bytes} bytes`);
      return response({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }] });
    },
  });
  const context = endgameContext();

  const result = await planner.plan(context);
  assert.ok(result.plan);
  assert.equal(calls.length, 1, 'byte-checking transport handled planning with no extra calls');
  const request = JSON.parse(calls[0].body);
  assert.ok(Buffer.byteLength(JSON.stringify(request.messages), 'utf8') <= 12_000,
    'a valid large endgame world is never paused at the prompt limit');
  const observation = JSON.parse(request.messages[1].content);

  // The trim chain is declarative and only drops entries; nothing is fabricated.
  // (checked against the observation only: the system prompt legitimately contains "omitted")
  assert.doesNotMatch(request.messages[1].content, /omitted information|placeholder|redacted/i);
  // Resource records shrink first, then older optional narrative if still needed.
  assert.equal(observation.board.length, 2);
  assert.deepEqual(observation.board, [
    { id: 'message-32', tick: 65998, citizenId: 'citizen-4', name: 'Sela', text: 'Fresh stock at crop-6; trade wood for food.' },
    { id: 'message-33', tick: 65997, citizenId: 'citizen-5', name: 'Sprig 1', text: 'Fresh stock at crop-7; trade wood for food.' },
  ]);
  assert.equal(observation.events.length, 2);
  assert.deepEqual(observation.citizen.memories, ['Sela asked about meeting near tree-4']);
  // Second fallback ran after the first: latest mail and most recent contacts.
  assert.deepEqual(observation.inbox.map((entry) => entry.id), ['message-3', 'message-4'], 'the latest incoming mail is preserved');
  assert.deepEqual(observation.inbox.at(-1).tick, 66000, 'the most recent incoming message ticks are kept');
  assert.ok(observation.inbox.every((entry) => entry.text.length <= 200), 'mail texts stay within the 200-char snapshot bound, not fabricated summaries');
  assert.deepEqual(observation.outbox.map((entry) => entry.id), ['message-13'], 'only the latest sent mail is preserved');
  assert.deepEqual(observation.contacts.map((entry) => entry.id),
    ['citizen-6', 'citizen-5', 'citizen-4', 'citizen-3', 'citizen-2', 'citizen-1'],
    'the six most recently observed contacts are preserved, oldest first');
  // Core knowledge survives the trim chain.
  assert.ok(observation.deposits.length <= 12);
  assert.ok(observation.deposits.some((deposit) => deposit.id === 'crop-2'), 'the current gather target remains');
  assert.deepEqual(observation.offers, []);
  assert.equal(observation.tick, 66000);
  assert.equal(observation.neighbors.length, 11);
  assert.equal(observation.citizen.id, 'citizen-1');
  assert.equal(context.board.length, 4, 'trimming does not mutate the caller context');
});

test('own bread/work, building snapshots, incidents and new history fields are allowlisted and bounded', async () => {
  let body;
  const planner = createPlanner({
    fetchImpl: async (_url, options) => {
      body = options.body;
      return response({ choices: [{ message: { content: JSON.stringify(plan) } }] });
    },
  });
  const context = endgameContext();
  context.citizen.bread = 3;
  context.citizen.work = { type: 'bake', target: 'bakery-0', food: 99, private: 'work-secret' };
  context.citizen.tasks = [
    { type: 'build', building: 'bakery', x: 2, y: 3, private: 'task-secret' },
    { type: 'bake', target: 'own', amount: 3 },
    { type: 'repair', target: 'bakery-0' },
    { type: 'guard', target: 'bakery-0', ticks: 120 },
  ];
  context.knownBuildings = Array.from({ length: 20 }, (_, index) => ({
    id: `bakery-${index}`, kind: 'bakery', x: index, y: 3, ownerId: 'citizen-2',
    health: 240, maxHealth: 240, observedAt: index, source: 'report', reportedBy: 'citizen-3',
    ownerInventory: 'owner-secret', ownerAlive: 'oracle-secret', liveHealth: 'health-secret',
  }));
  context.incidents = Array.from({ length: 7 }, (_, tick) => ({
    tick, attackerId: 'citizen-2', targetId: 'bakery-0', kind: 'building', x: 0, y: 3,
    private: 'incident-secret', attackerInventory: 'attacker-secret',
  }));
  context.inbox = [{ senderId: 'citizen-2', recipientId: 'citizen-1', text: 'Bakery report', shareBuildings: ['bakery-0'], private: 'mail-secret' }];
  context.board = [{ text: 'Bakery report', shareBuildings: ['bakery-0'] }];
  await planner.plan(context);
  const request = JSON.parse(body);
  assert.ok(Buffer.byteLength(JSON.stringify(request.messages), 'utf8') <= 12_000);
  const observation = JSON.parse(request.messages[1].content);
  assert.equal(observation.citizen.bread, 3);
  assert.deepEqual(observation.citizen.work, { type: 'bake', target: 'bakery-0' });
  assert.equal(observation.citizen.tasks.length, 4);
  assert.deepEqual(observation.citizen.tasks.map((task) => task.type), ['build', 'bake', 'repair', 'guard']);
  assert.ok(observation.knownBuildings.length <= 12);
  assert.ok(observation.knownBuildings.some((building) => building.id === 'bakery-0'), 'old active work target survives trimming');
  assert.ok(observation.knownBuildings.some((building) => building.id === 'bakery-19'), 'newest building survives trimming');
  assert.deepEqual(Object.keys(observation.knownBuildings[0]).sort(), ['health', 'id', 'kind', 'maxHealth', 'observedAt', 'ownerId', 'reportedBy', 'source', 'x', 'y']);
  assert.deepEqual(observation.incidents.map((incident) => incident.tick), [3, 4, 5, 6]);
  assert.deepEqual(observation.inbox[0].shareBuildings, ['bakery-0']);
  assert.deepEqual(observation.board[0].shareBuildings, ['bakery-0']);
  assert.doesNotMatch(request.messages[1].content, /secret|ownerAlive|ownerInventory|liveHealth|attackerInventory/);
  assert.equal(context.knownBuildings.length, 20);
});

test('guidance separates broad agency from mechanics and leaves room for evidence', () => {
  const role = SYSTEM_PROMPT.split('\n\nEVIDENCE\n')[0];
  assert.match(role, /independent and social choices/);
  assert.match(role, /no outcome is required/i);
  assert.doesNotMatch(role, /bake|trade|reproduce|gather|ask.*parents|beyond maintenance/);
  assert.match(SYSTEM_PROMPT, /Examples are possibilities, not recommendations/);
  assert.match(SYSTEM_PROMPT, /180 ticks AND 60 real seconds/);
  assert.match(SYSTEM_PROMPT, /Private mail interrupts work for priority review/);
  assert.ok(Buffer.byteLength(SYSTEM_PROMPT) <= 7000, 'tool documentation must leave space for citizen evidence');
});

test('the documented JSON example passes the real planner and world validator', async () => {
  const example = JSON.parse(SYSTEM_PROMPT.split('\n').at(-1));
  const world = createWorld();
  const citizen = world.citizens[0];
  const planner = createPlanner({ fetchImpl: async () => response({
    choices: [{ message: { content: JSON.stringify(example) } }],
  }) });
  const { plan: normalized } = await planner.plan(planningContext(world, citizen.id));
  applyPlan(world, citizen.id, normalized);
  assert.deepEqual(citizen.tasks, []);
  assert.equal(citizen.work, null);
});

test('planner check reports unavailable models without exposing upstream response bodies', async () => {
  const privateDetail = 'account-token-private';
  const planner = createPlanner({
    model: DEFAULT_MODEL,
    fetchImpl: async () => response({ detail: privateDetail }, { ok: false, status: 401 }),
  });
  await assert.rejects(planner.check(), (error) => {
    assert.ok(error instanceof PlannerError);
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /account-token-private/);
    return true;
  });
});

for (const projectContinuity of [false, true]) test(`strategy-review keeps full objectives and execution evidence within a crowded budget (continuity ${projectContinuity})`, async () => {
  const context = endgameContext();
  context.citizen.lastPlanError = 'E'.repeat(240);
  context.citizen.execution = { orderStartedAt: 65500, completedUnits: 3, investedTicks: 12, remainingTicks: null, interruptedBy: 'private message', lastReview: 'continue' };
  context.citizen.execution.blockedBy = 'Failure '.repeat(22).slice(0, 180);
  context.citizen.communications = [
    { type: 'post', text: 'P'.repeat(200) },
    { type: 'message', target: 'citizen-2', text: 'M'.repeat(200), location: true },
  ];
  context.citizen.undertaking = {
    objective: 'O'.repeat(160), success: 'S'.repeat(160), status: 'active',
    startedAt: 0, updatedAt: 65000, completedActions: 45, failedActions: 3,
  };
  let request;
  const planner = createPlanner({ strategyReview: true, projectContinuity, fetchImpl: async (_url, options) => {
    request = JSON.parse(options.body);
    return response({ choices: [{ message: { content: JSON.stringify(plan) } }] });
  } });
  await planner.plan(context);
  assert.ok(Buffer.byteLength(JSON.stringify(request.messages)) <= 12000);
  const sent = JSON.parse(request.messages[1].content);
  assert.deepEqual(sent.citizen.undertaking, context.citizen.undertaking);
  assert.deepEqual(sent.citizen.execution, context.citizen.execution);
  assert.deepEqual(sent.citizen.communications, context.citizen.communications);
  assert.equal(sent.citizen.lastPlanError, context.citizen.lastPlanError);
  assert.equal(sent.citizen.id, context.citizen.id);
  assert.equal(sent.neighbors.length, context.neighbors.length);
});
