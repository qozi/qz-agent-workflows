import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const skillFiles = [
  'LICENSE',
  'SKILL.md',
  'references/adoption.md',
  'references/collaboration.md',
  'references/lifecycle.md',
  'references/takeover.md',
  'templates/README.md',
  'templates/architecture.md',
  'templates/design.md',
  'templates/development.md',
  'templates/index.md',
  'templates/requirements.md',
  'templates/tasks.md',
  'templates/verification.md',
  'templates/workflow.md',
];
export const releaseFiles = [
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'docs/agent-install.md',
  'docs/releasing.md',
  'adapters/opencode/startup.md',
  'adapters/opencode/commands/dev-takeover.md',
  ...skillFiles.map((file) => `skills/dev-workflow/${file}`),
].sort();

/** 返回目录内普通文件；不跟随可能指向用户配置或工作资料的符号链接。 */
export async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`不允许符号链接：${relative}`);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`不允许特殊文件：${relative}`);
  }
  return files.sort();
}

/** 检查静态分发载荷并计算快照；不写文件，不执行安装或真实 Agent 加载。 */
export async function checkRepository(root = repositoryRoot) {
  const errors = [];
  const contents = new Map();
  const digest = createHash('sha256');
  for (const file of releaseFiles) {
    try {
      let current = root;
      for (const part of file.split('/')) {
        current = path.join(current, part);
        if ((await lstat(current)).isSymbolicLink()) throw new Error('不允许符号链接');
      }
      const bytes = await readFile(path.join(root, file));
      const text = bytes.toString('utf8');
      if (!text.trim()) errors.push(`${file}：文件为空`);
      contents.set(file, text);
      digest.update(file).update('\0').update(bytes).update('\0');
      if (/\/Users\/|\/home\/[^\s/]+\/|[A-Z]:\\Users\\/i.test(text)) errors.push(`${file}：包含机器专属路径`);
      if (/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/.test(text)) {
        errors.push(`${file}：疑似凭证`);
      }
      if (/requirement-workflow|requirement-takeover/.test(text)) errors.push(`${file}：包含已废弃入口名称`);
    } catch (error) {
      errors.push(`${file}：${error.message}`);
    }
  }

  for (const [directory, expected] of [
    ['skills', skillFiles.map((file) => `dev-workflow/${file}`).sort()],
    ['adapters', ['opencode/commands/dev-takeover.md', 'opencode/startup.md']],
  ]) {
    try {
      const actual = await listFiles(path.join(root, directory));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push(`${directory}：资源清单不匹配`);
    } catch (error) {
      errors.push(`${directory}：${error.message}`);
    }
  }

  const skill = contents.get('skills/dev-workflow/SKILL.md') ?? '';
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skill)?.[1] ?? '';
  for (const [field, pattern] of [
    ['name', /^name: dev-workflow$/m],
    ['description', /^description: \S.+$/m],
    ['license', /^license: MIT$/m],
  ]) {
    if (!pattern.test(frontmatter) || (frontmatter.match(new RegExp(`^${field}:`, 'gm')) ?? []).length !== 1) {
      errors.push(`SKILL.md：${field} 元数据缺失、重复或无效`);
    }
  }
  const version = /^metadata:\r?\n {2}version: "(\d+\.\d+\.\d+)"$/m.exec(frontmatter)?.[1];
  if (!version || (frontmatter.match(/^metadata:/gm) ?? []).length !== 1 || (frontmatter.match(/^ {2}version:/gm) ?? []).length !== 1) {
    errors.push('SKILL.md：metadata.version 必须是唯一且由引号包裹的语义版本字符串');
  }
  if (version && !(contents.get('CHANGELOG.md') ?? '').includes(`## ${version}`)) errors.push('CHANGELOG.md：缺少当前版本');
  if (!(contents.get('LICENSE') ?? '').startsWith('MIT License\n')) errors.push('LICENSE：缺少 MIT 授权');
  if (contents.get('LICENSE') !== contents.get('skills/dev-workflow/LICENSE')) errors.push('Skill LICENSE：必须与根许可证全文一致');

  const command = contents.get('adapters/opencode/commands/dev-takeover.md') ?? '';
  if (!/^---\r?\ndescription: \S[^\n]*\r?\n---\r?\n/.test(command)) errors.push('接管命令：缺少合法的 description frontmatter');
  if (!command.includes('`dev-workflow`') || (command.match(/\$ARGUMENTS/g) ?? []).length !== 1) {
    errors.push('接管命令：必须引用 dev-workflow 并保留唯一 $ARGUMENTS');
  }

  // 示例代码中的路径不代表仓库内真实链接；其余相对链接须在发行载荷内可解析。
  for (const [file, text] of contents) {
    const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
    for (const match of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const [target, fragment] = match[1].split('#');
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const resolved = target ? path.posix.normalize(path.posix.join(path.posix.dirname(file), target)) : file;
      const isDirectory = releaseFiles.some((candidate) => candidate.startsWith(`${resolved.replace(/\/$/, '')}/`));
      if (target.startsWith('/') || (!releaseFiles.includes(resolved) && !isDirectory)) errors.push(`${file}：链接不在发行载荷内：${target}`);
      if (file.startsWith('skills/') && !resolved.startsWith('skills/dev-workflow/')) {
        errors.push(`${file}：Skill 链接不能依赖安装单元之外的文件：${target}`);
      }
      if (fragment && contents.has(resolved)) {
        const headings = [...contents.get(resolved).matchAll(/^#{1,6} +(.+)$/gm)].map((heading) => heading[1]
          .toLowerCase().replace(/[`*_]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-'));
        if (!headings.includes(fragment)) errors.push(`${file}：链接锚点不存在：${match[1]}`);
      }
    }
    for (const match of text.matchAll(/工作流版本：[ \t]*dev-workflow ([\d.]+)/g)) {
      if (match[1] !== version) errors.push(`${file}：模板版本与 Skill 不一致`);
    }
  }

  try {
    const ignore = await readFile(path.join(root, '.gitignore'), 'utf8');
    if (!ignore.split(/\r?\n/).includes('/.dev-work/')) errors.push('.gitignore：缺少 /.dev-work/');
  } catch (error) {
    errors.push(`.gitignore：${error.message}`);
  }
  return { errors, version, files: releaseFiles, sha256: errors.length ? null : digest.digest('hex') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await checkRepository();
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`静态发行检查通过：dev-workflow ${result.version}，${result.files.length} 个文件`);
    console.log(`SHA-256 ${result.sha256}`);
    console.log(result.files.join('\n'));
    console.log('此结果不代表远程发布、安装成功或真实 Agent 加载。');
  }
}
