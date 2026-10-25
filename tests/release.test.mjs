import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkRepository, releaseFiles, repositoryRoot, skillFiles } from '../scripts/check.mjs';

/** 仅复制发行白名单到临时现场；绝不读取或改写真实家目录配置。 */
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qz-workflow-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of [...releaseFiles, '.gitignore']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await cp(path.join(repositoryRoot, file), path.join(root, file));
  }
  return root;
}

test('发行源码完整，快照摘要确定且不包含开发资料', async () => {
  const first = await checkRepository();
  assert.deepEqual(first.errors, []);
  assert.equal(first.version, '2.0.0');
  assert.equal(skillFiles.length, 15);
  assert.equal(first.sha256, (await checkRepository()).sha256);
  assert(first.files.every((file) => !file.includes('.dev-work') && !file.includes('.git/')));
});

test('缺失资源必须失败，不能以 Skill.md 存在视为完整安装', async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, 'skills/dev-workflow/references/takeover.md'));
  const result = await checkRepository(root);
  assert(result.errors.some((error) => error.includes('references/takeover.md')));
  assert.equal(result.sha256, null);
});

test('无效元数据、模板版本或版本说明会阻止发行', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'skills/dev-workflow/SKILL.md');
  const source = await readFile(file, 'utf8');
  for (const [before, after, expected] of [
    ['name: dev-workflow', 'name: other-workflow', 'name 元数据'],
    ['name: dev-workflow', 'name: dev-workflow\nname: dev-workflow', 'name 元数据'],
    ['license: MIT', 'license: unknown', 'license 元数据'],
    ['version: "2.0.0"', 'version: 2.0.0', 'metadata.version'],
    ['version: "2.0.0"', 'version: "9.0.0"', 'CHANGELOG.md'],
  ]) {
    assert(source.includes(before), before);
    await writeFile(file, source.replace(before, after));
    assert((await checkRepository(root)).errors.some((error) => error.includes(expected)), expected);
  }
  await writeFile(file, source);
  const template = path.join(root, 'skills/dev-workflow/templates/workflow.md');
  await writeFile(template, (await readFile(template, 'utf8')).replace('dev-workflow 2.0.0', 'dev-workflow 1.0.0'));
  assert((await checkRepository(root)).errors.some((error) => error.includes('模板版本')));
});

test('拒绝坏链接及对安装单元外文件的依赖', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'skills/dev-workflow/SKILL.md');
  const source = await readFile(file, 'utf8');
  for (const target of ['references/missing.md', '../../README.md', '/etc/passwd', '../../../outside.md', 'references/adoption.md#missing-section']) {
    await writeFile(file, `${source}\n[broken](${target})\n`);
    assert((await checkRepository(root)).errors.some((error) => error.includes(target)), target);
  }
});

test('不把代码块中的示例路径误认成资源链接', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'README.md');
  await writeFile(file, `${await readFile(file, 'utf8')}\n\x60\x60\x60markdown\n[示例](uncreated.md)\n\x60\x60\x60\n`);
  assert.deepEqual((await checkRepository(root)).errors, []);
});

test('发行资源内的目录链接合法，但空目录或越界目录不合法', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'skills/dev-workflow/SKILL.md');
  const source = await readFile(file, 'utf8');
  await writeFile(file, `${source}\n[目录](templates/)\n`);
  assert.deepEqual((await checkRepository(root)).errors, []);
  await writeFile(file, `${source}\n[空目录](nonexistent/)\n`);
  assert((await checkRepository(root)).errors.some((error) => error.includes('nonexistent/')));
});

test('拒绝额外 Skill 文件和可能逃逸目录的符号链接', async (t) => {
  const root = await fixture(t);
  const extra = path.join(root, 'skills/dev-workflow/local-backup.md');
  await writeFile(extra, '不应发布的备份');
  assert((await checkRepository(root)).errors.some((error) => error.includes('资源清单')));
  await rm(extra);
  const file = path.join(root, 'skills/dev-workflow/templates/tasks.md');
  await rm(file);
  await symlink(path.join(root, 'README.md'), file);
  assert((await checkRepository(root)).errors.some((error) => error.includes('符号链接')));
});

test('检测机器路径、凭证和废弃入口，不扫描用户家目录', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'README.md');
  const source = await readFile(file, 'utf8');
  for (const [text, expected] of [
    ['/Users/example/private-config', '机器专属路径'],
    [`ghp_${'a'.repeat(30)}`, '疑似凭证'],
    ['requirement-workflow', '废弃入口'],
  ]) {
    await writeFile(file, `${source}\n${text}\n`);
    assert((await checkRepository(root)).errors.some((error) => error.includes(expected)));
  }
});

test('接管命令不能丢失参数，开发资料必须被忽略', async (t) => {
  const root = await fixture(t);
  const command = path.join(root, 'adapters/opencode/commands/dev-takeover.md');
  await writeFile(command, (await readFile(command, 'utf8')).replace('$ARGUMENTS', ''));
  await writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
  const { errors } = await checkRepository(root);
  assert(errors.some((error) => error.includes('$ARGUMENTS')));
  assert(errors.some((error) => error.includes('.gitignore')));
});

test('独立安装单元必须携带完整且一致的 MIT 版权与许可', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'skills/dev-workflow/LICENSE'), 'MIT\n');
  assert((await checkRepository(root)).errors.some((error) => error.includes('Skill LICENSE')));
});

test('工作流保留关键语义，静态断言不替代完整语义审查', async () => {
  const skill = await readFile(path.join(repositoryRoot, 'skills/dev-workflow/SKILL.md'), 'utf8');
  for (const term of ['咨询', '简单任务', '唯一事实来源', '只读', 'worktree', '用户确认', '验收', '授权', '不自动迁移']) {
    assert(skill.includes(term), term);
  }
  const takeover = await readFile(path.join(repositoryRoot, 'skills/dev-workflow/references/takeover.md'), 'utf8');
  for (const term of ['默认仅检查', '原要求', '映射', '旧协调者']) assert(takeover.includes(term), term);
});
