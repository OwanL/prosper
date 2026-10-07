import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createMotionClock } from '../ui/motion.js';

// Probe the real UI helpers without starting a browser or fetching a model.
function helpers() {
  const delays = [];
  const elements = new Map();
  const createElement = () => ({
    children: [], dataset: {}, style: {}, scrollTop: 0, listeners: {}, attributes: {},
    get scrollHeight() { return this.children.length * 100; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; },
    classList: { add() {}, toggle() {} },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
  });
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, createElement());
    return elements.get(selector);
  };
  const context = vm.createContext({
    createMotionClock,
    document: { querySelector: element, createElement },
    window: { addEventListener() {}, setTimeout: (_callback, delay) => delays.push(delay) },
    AbortSignal, fetch: async () => { throw new Error('offline probe'); },
  });
  const source = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/\nsetupLayout\(\);\r?\npollOnce\(\);\s*$/, '\n');
  vm.runInContext(source, context);
  const api = vm.runInContext('({ pollInterval, pollOnce, markerOffsets, renderPlanner, renderCommunications, clearPollError, setState: value => { latestState = value; } })', context);
  return { ...api, delays, elements };
}

test('three feeds separate trades, private conversations and public posts while retaining family updates and independent scroll', () => {
  const api = helpers();
  const world = { tick: 30, citizens: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Ben' }],
    board: [{ id: 'post-1', citizenId: 'a', tick: 10, text: '<script>public text</script>' }],
    messages: [{ id: 'message-1', senderId: 'a', recipientId: 'b', tick: 20, text: 'Private terms' }],
    familyProposals: [{ id: 'family-1', makerId: 'b', recipientId: 'a', createdAt: 15, updatedAt: 25, status: 'accepted' }],
    offers: [{ id: 'offer-1', makerId: 'a', recipient: 'b', createdAt: 5, expiresAt: 100, status: 'cancelled', give: 'wood', giveAmount: 4, want: 'food', wantAmount: 2 },
      { id: 'offer-2', makerId: 'a', recipient: null, createdAt: 22, expiresAt: 100, status: 'open', give: 'food', giveAmount: 2, want: 'wood', wantAmount: 4 }],
  };
  api.setState({ world }); api.renderCommunications(world);
  const trades = api.elements.get('#trades-list'), privateFeed = api.elements.get('#private-list'), publicFeed = api.elements.get('#public-list');
  assert.deepEqual(Array.from(trades.children, c => c.dataset.id), ['offer-2', 'offer-1']);
  assert.deepEqual(Array.from(privateFeed.children, c => c.dataset.id), ['family-1', 'message-1']);
  assert.deepEqual(Array.from(publicFeed.children, c => c.dataset.id), ['post-1']);
  assert.equal(publicFeed.children[0].children.at(-1).textContent, '<script>public text</script>', 'message text is not interpreted as HTML');
  assert.equal(api.elements.get('#trades-count').textContent, '1 open / 2 total');
  privateFeed.scrollTop = 50;
  world.messages.push({ id: 'message-2', senderId: 'b', recipientId: 'a', tick: 30, text: 'Reply' });
  api.renderCommunications(world);
  assert.equal(privateFeed.scrollTop, 150, 'adding newer private mail preserves the reading position');
  assert.equal(publicFeed.scrollTop, 0);
  assert.equal(trades.scrollTop, 0);
  api.renderCommunications({});
  for (const kind of ['trades', 'private', 'public']) assert.equal(api.elements.get(`#${kind}-empty`).hidden, false);
});

test('citizen provider failures stay visible with a healthy connection and recovered history remains inspectable', () => {
  const api = helpers();
  const error = { tick: 429, citizenName: 'Edda', kind: 'provider', httpStatus: 429, message: 'Provider busy', retryAt: Date.now() + 120000, resolvedAt: null };
  const planner = { connection: 'ready', activeErrors: [error], errorHistory: [error], maxConcurrentTurns: 2, activeCitizenIds: [], meanTurnMs: 13000 };
  api.setState({ planner }); api.renderPlanner(planner); api.clearPollError();
  const banner = api.elements.get('#connection-banner');
  assert.equal(banner.hidden, false);
  assert.match(api.elements.get('#connection-message').textContent, /Edda: HTTP 429/);
  assert.match(api.elements.get('#planner-error').textContent, /Tick 429.*HTTP 429.*pending/);
  planner.activeErrors = []; error.resolvedAt = Date.now();
  api.renderPlanner(planner);
  assert.equal(banner.hidden, true);
  assert.match(api.elements.get('#planner-error').textContent, /recovered/);
});

test('compact messages retain full text and expansion through polls and reset on a new world', () => {
  const api = helpers();
  const message = 'A long message with quantities, terms and useful context. '.repeat(5);
  const world = { tick: 30, messages: [{ id: 'message-1', tick: 20, senderId: 'a', recipientId: 'b', text: message }] };
  api.setState({ world }); api.renderCommunications(world);
  const feed = api.elements.get('#private-list');
  const first = feed.children[0];
  const toggle = first.children.at(-1);
  assert.equal(first.children.find(c => c.className === 'communication-text').textContent, message);
  assert.equal(toggle.attributes['aria-expanded'], 'false');
  toggle.listeners.click();
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  world.tick++;
  api.renderCommunications(world);
  assert.equal(feed.children[0], first, 'unchanged messages retain their DOM and keyboard focus');
  world.messages.push({ id: 'message-2', tick: 31, senderId: 'b', recipientId: 'a', text: 'New reply' });
  api.renderCommunications(world);
  assert.equal(feed.children[1].children.at(-1).attributes['aria-expanded'], 'true');
  world.tick = 0;
  api.renderCommunications(world);
  assert.equal(feed.children[1].children.at(-1).attributes['aria-expanded'], 'false');
});

test('UI polling follows simulation speed and defaults safely', () => {
  const api = helpers();
  for (const [speed, expected] of [[1,750], [3,250], [8,100], ['8',100], [99,750], ['unknown',750], [undefined,750]]) {
    api.setState({ speed });
    assert.equal(api.pollInterval(), expected);
  }
});

test('fast UI polling retains disconnected backoff', async () => {
  const api = helpers();
  api.setState({ speed: 8 });
  for (let i = 0; i < 5; i++) await api.pollOnce();
  assert.deepEqual(api.delays, [1000,2000,4000,8000,8000]);
});

test('shared-tile citizen offsets stay compact and stable regardless of input ordering', () => {
  const { markerOffsets } = helpers();
  const people = Array.from({ length: 12 }, (_, i) => ({ id: `citizen-${i+1}`, x: 0, y: 0 }));
  const offsets = markerOffsets(people, 16, 10);
  const reverse = markerOffsets([...people].reverse(), 16, 10);
  for (const person of people) {
    const a = offsets.get(person.id), b = reverse.get(person.id);
    assert.ok(Math.hypot(a.x, a.y) <= 10);
    assert.equal(a.x, b.x); assert.equal(a.y, b.y);
    assert.equal(a.count, 12);
  }
  const solo = markerOffsets([{ id: 'solo', x: 4, y: 2 }], 16, 10).get('solo');
  assert.equal(solo.x, 0); assert.equal(solo.y, 0);
});
