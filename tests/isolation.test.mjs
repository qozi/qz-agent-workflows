import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { installerIntegrity, installerVersion, integrationEnvironment } from '../scripts/integration.mjs';

test('集成验证环境不继承真实 HOME、凭证、Git 配置或 Node 注入参数', () => {
  const root = path.resolve('synthetic-test-root');
  const env = integrationEnvironment(root, {
    PATH: '/test/bin', HOME: '/private-home', XDG_CONFIG_HOME: '/private-config',
    GH_TOKEN: 'secret', GITHUB_TOKEN: 'secret', SSH_AUTH_SOCK: 'private-agent',
    NODE_OPTIONS: '--require private-hook', GIT_CONFIG_GLOBAL: '/private-git', npm_config_cache: '/private-cache',
  });
  assert.equal(env.PATH, '/test/bin');
  assert.equal(env.LANG, 'C');
  assert.equal(env.LC_ALL, 'C');
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK', 'NODE_OPTIONS']) assert(!(name in env));
  for (const name of ['HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR', 'npm_config_cache', 'npm_config_userconfig', 'npm_config_globalconfig', 'GIT_CONFIG_GLOBAL']) {
    assert(env[name].startsWith(`${root}${path.sep}`), name);
  }
  assert.equal(env.DISABLE_TELEMETRY, '1');
  assert.equal(env.npm_config_ignore_scripts, 'true');
  assert.equal(installerVersion, '1.7.4');
  assert.match(installerIntegrity, /^sha512-/);
});
