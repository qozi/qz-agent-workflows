import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listFiles, skillFiles } from './check.mjs';

/** 只读比对完整安装单元；任何本地差异都需人工确认，不授权覆盖。 */
export async function compareSkill(source, installed) {
  const differences = [];
  for (const [label, directory] of [['源码', source], ['安装', installed]]) {
    try {
      if ((await lstat(directory)).isSymbolicLink()) throw new Error('目录本身是符号链接，请先核对实际来源');
      const resolved = await realpath(directory);
      if (path.resolve(directory) !== resolved) throw new Error(`父路径发生重定向，请先核对真实来源：${resolved}`);
      const files = await listFiles(directory);
      if (JSON.stringify(files) !== JSON.stringify([...skillFiles].sort())) differences.push(`${label}：资源清单不完整或有额外文件`);
    } catch (error) {
      differences.push(`${label}：${error.message}`);
    }
  }
  if (differences.length) return differences;
  for (const file of skillFiles) {
    try {
      const [expected, actual] = await Promise.all([
        readFile(path.join(source, file)), readFile(path.join(installed, file)),
      ]);
      if (!expected.equals(actual)) differences.push(`内容不同：${file}`);
    } catch (error) {
      differences.push(`${file}：${error.message}`);
    }
  }
  return differences;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [source, installed, ...extra] = process.argv.slice(2);
  if (!source || !installed || extra.length) {
    console.error('用法：node scripts/verify-installed.mjs <源码 Skill 目录> <安装 Skill 目录>');
    process.exitCode = 2;
  } else {
    const differences = await compareSkill(path.resolve(source), path.resolve(installed));
    if (differences.length) {
      console.error(differences.join('\n'));
      console.error('存在差异或无法核验，请停止覆盖并检查备份及授权。');
      process.exitCode = 1;
    } else {
      console.log('完整资源内容一致，可跳过重复安装；此结果不证明 Agent 已加载。');
    }
  }
}
