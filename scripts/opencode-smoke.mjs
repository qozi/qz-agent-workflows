import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { checkRepository, repositoryRoot } from './check.mjs';
import { integrationEnvironment } from './integration.mjs';

const execute = promisify(execFile);

/** 使用已有 OpenCode CLI 检查独立副本的发现与命令注册，不调用模型或复用凭证。 */
export async function runOpenCodeSmoke() {
  if (process.platform === 'darwin') {
    for (const file of [
      `/Library/Managed Preferences/${os.userInfo().username}/ai.opencode.managed.plist`,
      '/Library/Managed Preferences/ai.opencode.managed.plist',
    ]) {
      try { await access(file); }
      catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      throw new Error('检测到系统托管配置，无法仅通过 HOME/XDG 隔离；请使用 OS 级隔离环境');
    }
  }
  const checked = await checkRepository();
  assert.deepEqual(checked.errors, []);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'qz-workflow-opencode-')));
  try {
    const env = {
      ...integrationEnvironment(root),
      OPENCODE_TEST_HOME: path.join(root, 'home'),
      OPENCODE_CONFIG_DIR: path.join(root, 'config/opencode'),
      OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(root, 'managed'),
      OPENCODE_DISABLE_PROJECT_CONFIG: '1',
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_DISABLE_MODELS_FETCH: '1',
      OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
      OPENCODE_PURE: '1',
      OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
      OPENCODE_DISABLE_CLAUDE_CODE: '1',
      OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: 'true',
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ $schema: 'https://opencode.ai/config.json', plugin: [], mcp: {}, snapshot: false, share: 'disabled', autoupdate: false }),
    };
    for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR', 'npm_config_cache', 'OPENCODE_CONFIG_DIR', 'OPENCODE_TEST_MANAGED_CONFIG_DIR']) {
      await mkdir(env[key], { recursive: true });
    }
    for (const key of ['npm_config_userconfig', 'npm_config_globalconfig', 'GIT_CONFIG_GLOBAL']) await writeFile(env[key], '');
    const cwd = path.join(root, 'cwd');
    await mkdir(cwd);
    const installed = path.join(env.HOME, '.agents/skills/dev-workflow');
    await mkdir(path.dirname(installed), { recursive: true });
    await cp(path.join(repositoryRoot, 'skills/dev-workflow'), installed, { recursive: true });
    const commands = path.join(env.OPENCODE_CONFIG_DIR, 'commands');
    await mkdir(commands);
    const command = await readFile(path.join(repositoryRoot, 'adapters/opencode/commands/dev-takeover.md'), 'utf8');
    await writeFile(path.join(commands, 'dev-takeover.md'), command);
    const options = { cwd, env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 };
    const version = (await execute('opencode', ['--version'], options)).stdout.trim();
    assert.equal(version, '1.19.0', '仅审查过 OpenCode 1.19.0 的隔离机制；其他版本请先复核，再运行 debug 检查');
    const skills = JSON.parse((await execute('opencode', ['debug', 'skill'], options)).stdout);
    const found = skills.find((skill) => skill.name === 'dev-workflow');
    assert(found, 'OpenCode 未发现 dev-workflow');
    assert.equal(found.location, path.join(installed, 'SKILL.md'));
    const entry = await readFile(path.join(installed, 'SKILL.md'), 'utf8');
    assert.equal(found.content.trim(), entry.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim());
    const config = JSON.parse((await execute('opencode', ['debug', 'config'], options)).stdout);
    assert(config.command?.['dev-takeover']?.description);
    assert.equal(config.command['dev-takeover'].template.trim(), command.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim());
    return {
      opencode: version,
      sourceSha256: checked.sha256,
      skillDiscovery: '通过：新进程发现隔离副本且路径及正文匹配',
      commandRegistration: '通过：新进程解析 dev-takeover，正文与源码匹配',
      limitations: '只证明 CLI 发现与命令注册；未调用模型、skill 工具或斜杠命令，也不证明启动规则实际生效。',
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await runOpenCodeSmoke(), null, 2)); }
  catch (error) { console.error(error.stack); process.exitCode = 1; }
}
