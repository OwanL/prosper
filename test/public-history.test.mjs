import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../lib/world.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';

function fixture() {
  const world = createWorld({ expanded: false });
  const tools = id => { const session = createCitizenToolSession({ getWorld: () => world, citizenId: id }); session.refresh(); return session; };
  const publisher = tools('citizen-1');
  publisher.execute('post_public_message', { text: 'SE ring2 is where I mean to settle. I will bargain with neighbours, but expect my boundaries respected.' });
  for (let i = 0; i < 3; i++) {
    world.tick++;
    assert.equal(publisher.execute('post_public_message', { text: `Bread lot ${i}: look up the actual offer before buying.` }).ok, true);
  }
  assert.equal(publisher.execute('send_private_message', { to: 'citizen-3', text: 'Private-only secret terms.' }).ok, true);
  return { world, reader: tools('citizen-2') };
}

test('public search retrieves an older dated notice beyond the automatic preview without treating it as ownership', () => {
  const { world, reader } = fixture();
  const observation = reader.refresh();
  assert.equal(observation.board.some(m => m.text.includes('boundaries')), false);
  const before = JSON.stringify(world);
  const result = reader.execute('get_history', { publicQuery: 'south-east ring-2' });
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].text, /boundaries/);
  assert.equal(result.items[0].tick, 0);
  assert.equal(result.items[0].ageTicks, 3);
  assert.equal(result.items[0].by.id, 'citizen-1');
  assert.match(result.note, /not enforced ownership/);
  assert.equal(JSON.stringify(world), before, 'retrieval creates no territorial right or world mutation');
  assert.equal(world.stats.attacks, 0);
});

test('public pages exclude private mail, preserve author/times and keep default history private to the caller', () => {
  const { world, reader } = fixture();
  const first = reader.execute('get_history', { publicQuery: '', limit: 2 });
  assert.equal(first.items.length, 2);
  assert.equal(first.omitted, 2);
  const second = reader.execute('get_history', { publicQuery: '', limit: 2, after: first.nextAfter });
  assert.equal(second.items.length, 2);
  assert.equal(second.nextAfter, null);
  assert.equal(new Set([...first.items, ...second.items].map(m => m.id)).size, 4);
  assert.ok(!JSON.stringify([first, second]).includes('Private-only'));
  const own = reader.execute('get_history', {});
  assert.ok(own.memories);
  assert.equal(own.scope, undefined);
  assert.ok(!JSON.stringify(own).includes('Private-only'));
  assert.equal(reader.execute('get_history', { publicQuery: '', limit: 9 }).ok, false);
  assert.equal(reader.execute('get_history', { publicQuery: '', after: world.messages.at(-1).id }).ok, false);
});
