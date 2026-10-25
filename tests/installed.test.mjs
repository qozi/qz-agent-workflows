import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { repositoryRoot } from '../scripts/check.mjs';
import { compareSkill } from '../scripts/verify-installed.mjs';

const source = path.join(repositoryRoot, 'skills/dev-workflow');

/** 构造临时安装副本；清理仅限测试创建的临时根目录。 */
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'qz-workflow-installed-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installed = path.join(root, 'installed');
  await cp(source, installed, { recursive: true });
  return { root, installed };
}

test('重复接入先只读比对，相同内容可跳过且不改写', async (t) => {
  const { installed } = await fixture(t);
  assert.deepEqual(await compareSkill(source, installed), []);
  assert.deepEqual(await compareSkill(source, installed), []);
});

test('发现本地修改、版本升级或额外文件时停止，不覆盖现场', async (t) => {
  const { installed } = await fixture(t);
  const file = path.join(installed, 'SKILL.md');
  const original = await readFile(file, 'utf8');
  for (const changed of [`${original}\n本地修改\n`, original.replace('"2.0.0"', '"1.0.0"')]) {
    await writeFile(file, changed);
    assert((await compareSkill(source, installed)).some((difference) => difference.includes('SKILL.md')));
    assert.equal(await readFile(file, 'utf8'), changed);
  }
  await writeFile(path.join(installed, 'local.md'), '本地产物');
  assert((await compareSkill(source, installed)).some((difference) => difference.includes('额外文件')));
});

test('不完整安装和来源缺失可诊断且不返回成功', async (t) => {
  const { root, installed } = await fixture(t);
  await rm(path.join(installed, 'references/takeover.md'));
  assert((await compareSkill(source, installed)).length > 0);
  assert((await compareSkill(path.join(root, 'missing'), installed)).length > 0);
});

test('失败后可从授权前保存的完整副本恢复并重新验证', async (t) => {
  const { root, installed } = await fixture(t);
  const backup = path.join(root, 'backup');
  await cp(installed, backup, { recursive: true });
  await rm(path.join(installed, 'templates/tasks.md'));
  assert((await compareSkill(source, installed)).length > 0);
  await rm(installed, { recursive: true });
  await cp(backup, installed, { recursive: true });
  assert.deepEqual(await compareSkill(source, installed), []);
});

test('无法读取的目录和符号链接来源必须报错', async (t) => {
  const { root, installed } = await fixture(t);
  const notDirectory = path.join(root, 'not-a-directory');
  await writeFile(notDirectory, '模拟不可访问目标；真实权限行为依操作系统而异');
  assert((await compareSkill(source, notDirectory)).length > 0);
  const link = path.join(root, 'linked');
  await symlink(installed, link);
  assert((await compareSkill(source, link)).some((difference) => difference.includes('符号链接')));
  const linkedParent = path.join(root, 'parent-link');
  await symlink(root, linkedParent);
  assert((await compareSkill(source, path.join(linkedParent, 'installed'))).some((difference) => difference.includes('父路径发生重定向')));
});
