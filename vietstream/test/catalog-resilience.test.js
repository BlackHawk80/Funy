'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cachedCatalog } = require('../src/utils');
const { KKphimProvider } = require('../src/providers/kkphim');
const { PROVIDERS } = require('../src/config');

test('failed cold request is not cached; next request recovers', async () => {
  await assert.rejects(cachedCatalog('cold', async () => { throw Error('offline'); }));
  assert.deepEqual((await cachedCatalog('cold', async () => [{ id: 'ok' }])).metas, [{ id: 'ok' }]);
});
test('stale success survives upstream failure but expires after its bound', async () => {
  await cachedCatalog('stale', async () => [{ id: 'old' }], { ttl: -1 });
  const result = await cachedCatalog('stale', async () => { throw Error('offline'); });
  assert.equal(result.stale, true);
  assert.equal(result.metas[0].id, 'old');
  await cachedCatalog('expired', async () => [{ id: 'old' }], { ttl: -1, staleTtl: -1 });
  await assert.rejects(cachedCatalog('expired', async () => { throw Error('offline'); }));
});
test('legitimate empty pages stay empty and are not cached', async () => {
  await cachedCatalog('empty', async () => [{ id: 'old' }], { ttl: -1 });
  assert.deepEqual((await cachedCatalog('empty', async () => [])).metas, []);
  await assert.rejects(cachedCatalog('empty', async () => { throw Error('offline'); }));
});
test('concurrent requests share one upstream call and different pages stay isolated', async () => {
  let calls = 0;
  const fn = async () => { calls++; return [{ id: 'one' }]; };
  await Promise.all([cachedCatalog('shared', fn), cachedCatalog('shared', fn)]);
  assert.equal(calls, 1);
  await assert.rejects(cachedCatalog('different-page', async () => { throw Error('offline'); }));
});
test('KKPhim retries transient failure and rejects invalid payload', async () => {
  const p = new KKphimProvider(PROVIDERS.kkphim);
  let calls = 0;
  p.request = async () => ++calls === 1 ? null : { status: true, data: { items: [] } };
  assert.deepEqual((await p.listCatalog('phim-le')), []);
  assert.equal(calls, 2);
  p.request = async () => ({ status: true, data: {} });
  await assert.rejects(p.listCatalog('viet-nam'), /UNAVAILABLE/);
});
