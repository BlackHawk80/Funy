'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const configPath = path.resolve(__dirname, '../src/config.js');

function readConfig(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.XEM20_LOGIN;
  delete env.XEM20_PASSWORD;
  Object.assign(env, extraEnv);
  const script = `const {PROVIDERS}=require(${JSON.stringify(configPath)}); process.stdout.write(JSON.stringify({enabled:PROVIDERS.xem20.enabled,login:PROVIDERS.xem20.login,password:PROVIDERS.xem20.password}))`;
  const result = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('Xem20 is hidden when credentials are absent', () => {
  assert.deepEqual(readConfig(), { enabled: false, login: '', password: '' });
});

test('Xem20 is enabled only when both credentials are provided', () => {
  assert.deepEqual(readConfig({ XEM20_LOGIN: 'user', XEM20_PASSWORD: 'pass' }), {
    enabled: true,
    login: 'user',
    password: 'pass'
  });
  assert.equal(readConfig({ XEM20_LOGIN: 'user' }).enabled, false);
});
