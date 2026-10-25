# qz-agent-workflows

本仓库维护可分发的 AI Agent 开发协作 Skill。`skills/` 是发布源码，`adapters/` 是工具接入材料，`tests/` 和 `scripts/` 负责验证；用户安装目录不是开发源码，不自动覆盖或反向同步。

首轮仅正式适配 OpenCode，不开发自有 npm CLI。文档、注释默认中文，手工修改使用 apply_patch。测试使用 Node.js 内置测试运行器，不依赖真实家目录，不修改全局 Agent 配置。

验证命令：`node --test tests/*.test.mjs`；发行检查：`node scripts/check.mjs`。可选标准安装器集成验证见 README，必须使用固定版本和临时 HOME。

需求协作资料见 [本地工作流说明](.dev-work/workflow.md)；子工作区缺少此文件时，按主 Agent 派发的资料位置只读访问，不在本地补建。
