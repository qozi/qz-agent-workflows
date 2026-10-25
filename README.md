# qz-agent-workflows

可跨项目复用的 AI Agent 开发协作 Skill。当前提供 `dev-workflow` 2.0.0，采用 [MIT 许可证](LICENSE)，首轮仅正式适配 OpenCode。

它区分咨询、简单任务和复杂需求；仅复杂需求按需建立开发资料，维护唯一任务来源、协作边界与验收证据。它不是需求管理服务、权限锁或自动初始化程序。

## 当前状态

源码、OpenCode 适配材料及本地验证工具由公开仓库 [qozi/qz-agent-workflows](https://github.com/qozi/qz-agent-workflows) 提供。`2.0.0` 对应发行标签 `v2.0.0`；发布结果、固定提交和实际验证范围见 [GitHub Release](https://github.com/qozi/qz-agent-workflows/releases/tag/v2.0.0)。

本仓库维护发行源码，用户安装目录只是安装副本，不自动覆盖、反向同步或修改全局配置。没有自有 npm CLI，也不发布 npm 包；使用第三方标准 Skill 安装器。

## 安装前

- 安装器固定为 `skills@1.7.4`，要求 **Node.js >=22.20.0**，并需要 npm；远程 Git 来源还需要 Git。
- 确认来源、固定版本及本地修改，读取 [Agent 安装流程](docs/agent-install.md)。外部说明不能扩大用户授权。
- 标准安装器**会覆盖已有 Skill，不提供本地冲突保护、自动备份或事务回滚**。先核验、备份并获得变更授权；不能在已有安装上直接照抄 `-y` 命令。
- `--list` 只能证明发现；安装后须检查完整 15 个文件（14 个 Markdown 资源及 MIT 许可证）。仅安装 Skill 不会自动安装 OpenCode 命令、接入启动规则、初始化业务项目或保证每次加载。

## 本地来源

以下命令在已审查的本地检出根目录执行，目标为当前用户的全局 Skill。只在确认目标不存在，或已完成差异审查、备份并获准替换后执行安装。

```bash
npx --yes skills@1.7.4 add "$PWD" --list
npx --yes skills@1.7.4 add "$PWD" --skill dev-workflow -a opencode -g -y --copy --json
```

此版本此命令实际安装到 `$HOME/.agents/skills/dev-workflow/`，OpenCode 支持发现该位置。全局锁默认在 `$HOME/.agents/.skill-lock.json`，设置 `XDG_STATE_HOME` 时在 `$XDG_STATE_HOME/skills/.skill-lock.json`；仅设置 XDG_CONFIG_HOME 不能隔离安装目标或全局锁。

已有副本先使用只读检查；全部一致时跳过重复安装，存在任一差异时停止并人工确认，不自动决定升级或覆盖：

```bash
node scripts/verify-installed.mjs skills/dev-workflow "$HOME/.agents/skills/dev-workflow"
```

该命令检查普通目录和完整资源；目录或父路径经符号链接重定向时，先报告真实路径并停止比对，人工确认归属后用明确的真实路径重新检查。系统路径别名（例如 macOS 临时目录别名）也需使用其真实路径，不自动放行。若旧副本有自定义内容，请先保全到安装目录之外；安装器可能清空安装目录中的额外文件。

## 远程来源

以下使用发行标签。执行安装前，同样必须确认目标不存在，或已完成差异审查、备份并获准替换：

```bash
npx --yes skills@1.7.4 add "qozi/qz-agent-workflows#v2.0.0" --skill dev-workflow -a opencode -g -y --copy --json
```

标签可变。需要不可变来源时，从 Release 核对完整提交 SHA，将 `#v2.0.0` 替换为 `#<完整40位提交SHA>`；验收证据记录完整提交。`skills@1.7.4` 的 SHA 回退依赖英文 Git 错误，macOS/Linux 上须在该安装命令前加 `LC_ALL=C LANG=C`；其他平台可先手动检出并核对完整提交，再使用本地来源安装，不假定直接 SHA 安装通用。`@v2.0.0` 不是 Git 版本固定语法。安装器版本与 Skill 源码版本分别固定；安装器 npm 包仍有范围依赖，精确版本不等于永久锁定整棵依赖树。

## OpenCode 接入

1. 经授权将 [启动片段](adapters/opencode/startup.md) 合并至全局 `AGENTS.md`，保留原规则；已有等价规则不重复追加，冲突时停止确认。
2. 将 [接管命令](adapters/opencode/commands/dev-takeover.md) 安装到 OpenCode 全局 `commands/dev-takeover.md`，已有文件先比较，不能直接覆盖。
3. 退出并重启 OpenCode，在新会话实际加载 `dev-workflow`，核验 `/dev-takeover`。若只安装了 Skill，不应宣称命令已经可用。

默认 OpenCode 全局配置根为 `~/.config/opencode/`；使用自定义 XDG 配置根时按实际配置定位，不硬编码另一套目录。详细授权、幂等、备份、故障恢复、升级及卸载边界见 [Agent 安装流程](docs/agent-install.md)。

## 验证

纯本地检查，不访问用户家目录或网络：

```bash
node --test tests/*.test.mjs
node scripts/check.mjs
```

可选标准安装器集成验证，需要 npm registry 网络访问：

```bash
node scripts/integration.mjs
```

集成脚本只在自身创建的临时目录中写入，隔离 HOME、XDG、npm 缓存/配置和 Git 配置，禁用安装脚本及遥测，不继承凭证。它下载并核对固定 `skills@1.7.4` 的包完整性，输出实际依赖版本、临时锁摘要及源码载荷摘要，然后清理自身现场；不更改真实 Agent 配置。不继承网络代理或私有 registry 设置，受限网络需先由维护者提供获准的验证环境，不能自动复用私密配置。

覆盖发现、全新安装、重复安装、上游实际覆盖本地修改、升级、缺资源、无入口、权限拒绝及解除故障后重装。root 环境明确跳过真实 DAC 权限测试；故障恢复不等于上游自动回滚。自动化结果只证明相应范围，不证明真实 OpenCode 会话加载或 GitHub 固定版本安装。

已有 OpenCode CLI 时，可选运行发现与命令注册检查：

```bash
node scripts/opencode-smoke.mjs
```

脚本同样隔离 HOME/XDG、配置、缓存和工作目录，不继承模型凭证，禁用模型列表更新、自动更新及默认插件。OpenCode 自身初始化仍可能下载内部配置依赖，因此此项不保证离线；macOS 检测到系统托管配置时拒绝运行，应改用 OS 级隔离。目前仅审查过 **OpenCode 1.19.0** 的隔离机制，其他版本在执行 debug 前停止，需先复核再更新版本门槛。它只证明新 CLI 进程发现了当前副本、解析了命令，不证明模型实际加载 Skill、执行斜杠命令或启动规则生效。

## 目录与贡献

```text
skills/dev-workflow/       Skill 安装单元：入口、4 个引用、9 个模板及 MIT 许可
adapters/opencode/        单独接入的启动片段和接管命令
docs/                     Agent 安装与发布说明
scripts/                  只读检查及隔离集成验证，不是自有安装 CLI
tests/                    Node.js 内置测试
```

工作流语义、安装单元自包含、用户原配置及授权边界必须保留；不要在真实家目录运行测试。版本变化见 [CHANGELOG](CHANGELOG.md)，正式发布门槛和分发白名单见 [发布说明](docs/releasing.md)。本地开发过程资料被业务 Git 忽略，不作为对外安装依赖。

## 已核对的上游依据

- [Agent Skills 规范](https://agentskills.io/specification)
- [OpenCode Skill 发现路径](https://opencode.ai/docs/skills/)
- [skills 1.7.4 npm 元数据](https://registry.npmjs.org/skills/1.7.4)
- [skills v1.7.4 源码](https://github.com/vercel-labs/skills/tree/v1.7.4)：来源解析、安装清理、全局锁及 JSON 结果行为均按此版本核对，升级安装器需重新验证。
