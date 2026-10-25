import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { checkRepository, repositoryRoot } from './check.mjs';
import { compareSkill } from './verify-installed.mjs';

const execute = promisify(execFile);
export const installerVersion = '1.7.4';
export const installerIntegrity = 'sha512-lHZJksE8UImNAr+LL6unqq7jERjdFw5EJasm17srycwL7rXHGdCmgu1L1ttLxUO9i3rdH+QQig+px0icHqLmRw==';

/** 显式隔离 HOME、XDG、npm 与 Git；不继承凭证、模型配置或 Node 注入参数。 */
export function integrationEnvironment(root, inherited = process.env) {
  return {
    PATH: inherited.PATH ?? '',
    HOME: path.join(root, 'home'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
    XDG_DATA_HOME: path.join(root, 'data'),
    TMPDIR: path.join(root, 'tmp'),
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_userconfig: path.join(root, 'npmrc'),
    npm_config_globalconfig: path.join(root, 'global-npmrc'),
    npm_config_update_notifier: 'false',
    npm_config_ignore_scripts: 'true',
    NODE_DISABLE_COMPILE_CACHE: '1',
    DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    CI: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'),
    GIT_TERMINAL_PROMPT: '0',
  };
}

/** 执行真实固定版安装器，所有写入和故障注入限于本次创建的临时目录。 */
export async function runIntegration() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  assert(major > 22 || (major === 22 && (minor > 20 || (minor === 20 && patch >= 0))), 'skills@1.7.4 要求 Node >=22.20.0');
  const checked = await checkRepository();
  assert.deepEqual(checked.errors, [], '先通过静态发行检查');
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'qz-workflow-integration-')));
  const results = [];
  try {
    async function sandbox(name) {
      const directory = path.join(root, name);
      const env = integrationEnvironment(directory);
      await mkdir(path.join(directory, 'cwd'), { recursive: true });
      for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR', 'npm_config_cache']) {
        await mkdir(env[key], { recursive: true });
      }
      for (const key of ['npm_config_userconfig', 'npm_config_globalconfig', 'GIT_CONFIG_GLOBAL']) await writeFile(env[key], '');
      return { directory, env, cwd: path.join(directory, 'cwd'), target: path.join(env.HOME, '.agents/skills/dev-workflow') };
    }

    const tools = await sandbox('tools');
    const toolDirectory = path.join(tools.directory, 'installer');
    await mkdir(toolDirectory);
    await writeFile(path.join(toolDirectory, 'package.json'), JSON.stringify({ name: 'qz-workflow-installer-fixture', private: true }));
    const npmOptions = { cwd: toolDirectory, env: tools.env, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 };
    const npmVersion = (await execute('npm', ['--version'], npmOptions)).stdout.trim();
    await execute('npm', ['install', '--prefix', toolDirectory, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `skills@${installerVersion}`], npmOptions);
    const lockBytes = await readFile(path.join(toolDirectory, 'package-lock.json'));
    const lock = JSON.parse(lockBytes);
    const installer = lock.packages['node_modules/skills'];
    assert(installer, `安装器锁缺少 skills 条目：${JSON.stringify(Object.keys(lock.packages))}`);
    assert.equal(installer.version, installerVersion);
    assert.equal(installer.integrity, installerIntegrity, '固定 npm 包完整性必须匹配已审查版本');
    const cli = path.join(toolDirectory, 'node_modules/skills/bin/cli.mjs');
    const source = path.join(root, 'source');
    const sourceSkill = path.join(source, 'skills/dev-workflow');
    await mkdir(path.dirname(sourceSkill), { recursive: true });
    await cp(path.join(repositoryRoot, 'skills/dev-workflow'), sourceSkill, { recursive: true });

    async function invoke(context, input = source, list = false) {
      const args = [cli, 'add', input, ...(list ? ['--list'] : ['--skill', 'dev-workflow', '-a', 'opencode', '-g', '-y', '--copy', '--json'])];
      let output;
      try {
        output = { ...await execute(process.execPath, args, { cwd: context.cwd, env: context.env, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }), code: 0 };
      } catch (error) {
        if (typeof error.code !== 'number') throw error;
        output = { stdout: error.stdout, stderr: error.stderr, code: error.code };
      }
      if (!list) {
        try { output.json = JSON.parse(output.stdout); }
        catch { throw new Error(`安装器未返回有效 JSON（退出码 ${output.code}）：${output.stdout}\n${output.stderr}`); }
        assert(Array.isArray(output.json), '安装器 JSON 必须是结果数组');
        if (output.code === 0) {
          assert(output.json.some((item) => item.name === 'dev-workflow' && item.status === 'installed'), JSON.stringify(output.json));
          assert(output.json.every((item) => item.status === 'installed'), JSON.stringify(output.json));
        }
      }
      return output;
    }

    const fresh = await sandbox('fresh');
    const discovered = await invoke(fresh, source, true);
    assert.equal(discovered.code, 0);
    assert.match(discovered.stdout, /dev-workflow/);
    results.push('发现：--list 识别 dev-workflow');
    const installed = await invoke(fresh);
    assert.equal(installed.code, 0, installed.stderr);
    assert.deepEqual(await compareSkill(sourceSkill, fresh.target), []);
    const globalLock = JSON.parse(await readFile(path.join(fresh.env.XDG_STATE_HOME, 'skills/.skill-lock.json'), 'utf8'));
    assert.equal(globalLock.version, 3);
    assert.equal(globalLock.skills['dev-workflow'].sourceType, 'local');
    assert.equal(globalLock.skills['dev-workflow'].sourceUrl, source);
    results.push('全新安装：完整 15 文件（含 MIT 许可）逐字节一致');

    assert.equal((await invoke(fresh)).code, 0);
    assert.deepEqual(await compareSkill(sourceSkill, fresh.target), []);
    results.push('重复安装：内容一致，但标准安装器会重新覆盖而非幂等跳过');

    const modifiedFile = path.join(fresh.target, 'templates/tasks.md');
    await writeFile(modifiedFile, '本地修改，禁止在真实用户目录中无授权覆盖\n');
    assert((await compareSkill(sourceSkill, fresh.target)).length > 0);
    assert.equal((await invoke(fresh)).code, 0);
    assert.deepEqual(await compareSkill(sourceSkill, fresh.target), []);
    results.push('本地冲突：只读预检能检出；标准安装器实际覆盖，不能依赖其保护');

    const upgraded = path.join(root, 'upgraded');
    await cp(source, upgraded, { recursive: true });
    const upgradedSkill = path.join(upgraded, 'skills/dev-workflow');
    const upgradedEntry = path.join(upgradedSkill, 'SKILL.md');
    await writeFile(upgradedEntry, (await readFile(upgradedEntry, 'utf8')).replace('version: "2.0.0"', 'version: "2.0.1"'));
    await writeFile(path.join(fresh.target, 'obsolete.md'), '旧文件');
    assert.equal((await invoke(fresh, upgraded)).code, 0);
    assert.deepEqual(await compareSkill(upgradedSkill, fresh.target), []);
    results.push('升级：新版本完整一致，旧额外文件被清理');

    const damaged = path.join(root, 'damaged');
    await cp(source, damaged, { recursive: true });
    await rm(path.join(damaged, 'skills/dev-workflow/references/takeover.md'));
    const incomplete = await sandbox('incomplete');
    assert.equal((await invoke(incomplete, damaged)).code, 0);
    assert((await compareSkill(sourceSkill, incomplete.target)).length > 0);
    results.push('缺资源：安装器仍可成功，自有完整性核验拒绝不完整安装');

    await rm(path.join(damaged, 'skills/dev-workflow/SKILL.md'));
    const invalid = await invoke(incomplete, damaged);
    assert.notEqual(invalid.code, 0);
    assert(invalid.json.some((item) => item.status === 'failed'));
    results.push('缺入口：来源无 SKILL.md 时安装器返回失败');

    const permission = await sandbox('permission');
    const parent = path.dirname(permission.target);
    await mkdir(parent, { recursive: true });
    if (process.getuid?.() === 0) {
      results.push('权限拒绝：root 环境跳过真实 DAC 验证，不计通过');
    } else {
      await chmod(parent, 0o500);
      try {
        const failed = await invoke(permission);
        assert.notEqual(failed.code, 0);
        assert.match(JSON.stringify(failed.json), /failed|EACCES|permission/i);
      } finally {
        await chmod(parent, 0o700);
      }
      results.push('权限拒绝：真实不可写临时父目录下安装失败');
    }
    assert.equal((await invoke(permission)).code, 0);
    assert.deepEqual(await compareSkill(sourceSkill, permission.target), []);
    results.push('故障恢复：解除权限故障后重新安装完整，不代表自动回滚');

    return {
      node: process.versions.node,
      npm: npmVersion,
      installer: `skills@${installerVersion}`,
      installerIntegrity,
      dependencyLockSha256: createHash('sha256').update(lockBytes).digest('hex'),
      dependencies: Object.fromEntries(Object.entries(lock.packages).filter(([key]) => key).map(([key, value]) => [key, { version: value.version, integrity: value.integrity }])),
      sourceSha256: checked.sha256,
      results,
      limitations: '仅本地来源标准安装器；未验证远程发布、GitHub 固定提交安装或真实 OpenCode 会话加载。',
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await runIntegration(), null, 2));
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
