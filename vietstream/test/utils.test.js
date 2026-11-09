'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getJson } = require('../src/utils');

test('HTTP timeout remains active until fetch settles', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

  const started = Date.now();
  try {
    const result = await getJson('https://timeout.test', { timeout: 25 });
    const elapsed = Date.now() - started;
    assert.equal(result, null);
    assert.ok(elapsed >= 15, `timeout fired too early: ${elapsed}ms`);
    assert.ok(elapsed < 500, `timeout did not fire: ${elapsed}ms`);
  } finally {
    global.fetch = originalFetch;
  }
});
