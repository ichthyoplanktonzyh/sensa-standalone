# 原生能力与验收状态

2026-09-10。此文合并原生迁移期间的计划、交接和 UI 优化过程记录。它记录已有实现与历史证据，
不是领域模型，也不把阶段通过转换为生产验收。当前范围以 [迁移清单](native-migration-checklist.md)、
[UI 验收矩阵](native-ui-acceptance-matrix.md)、current-stage 与 PRD 为准。
新的账号优先/Sensa 默认服务体验覆盖旧记录中的免账号主入口与普通用户手填服务配置要求。

## 能力摘要

| 能力 | 已有实现与历史证据 | 当前保留边界 |
| --- | --- | --- |
| 本地库与轻量学习 | Rust/SQLite、Flutter 桥接、包校验/版本冲突、显式入学、首学/Review/Relearning、幂等事务、独立进程恢复；macOS/Android 有集成记录 | Web 本地闭环、完整备份、跨端合并及发布另验；不迁移 owner 数据 |
| 内核、Policy 与高保证 | TS/Rust 规则对照、通用 progression/journal、固定 Profile/材料、首学/复习/修复队列及正式产品集成 | 四阶段纯内核/编排证据不等于正式 Flutter UI；Policy Migration 未完成 |
| 活动与学习组织 | Mixed/Review-only、固定范围、每日 Introduction 与预留分离、独立签到、Book/Enrollment/Range、来源排序/历史 | 不从签到推导 Evidence；范围和内容更新不改写已开始 Run |
| 个人语义世界 | 图文草稿、快慢轨、可选 Focus、明确接受、稳定身份、表达分支、搜索/关系投影、移除恢复 | 不完整材料是草稿/Inbox；纯音频等未支持输入不得伪装已处理 |
| 语言老师与准备 | 有界工具循环、自然语言更正、独立接受；显式入学后生成/独立审核/冻结材料 | 模型质量与真实服务另验；重启不自动付费重试，迟到/撤销结果拒绝 |
| 原文与参考资源 | 版本化授权/撤销、旧 Run 保留、参考摘录准入、可选文本角色、静态发音摘要与缓存、流式处理 | 宽覆盖参考词典、任意表达实时 TTS 和完整发布治理未关闭；不能收回已发送内容 |
| Provider 与账号 | 后续 Provider 组补齐系统安全凭据存储；资源组补齐 OTP、刷新/退出、跨库隔离与冷恢复的合成服务验证 | 早期“Key 仅内存”是历史状态；真实邮件、生产服务、稳定分发签名尚待验收；普通用户配置入口需按新 PRD 重做 |
| Intake | 插件可选 Native Messaging、本机 CLI/Agent、统一准入/回执、断线和重启恢复 | 远程 Agent、移动系统分享、Linux/Windows 安装签名、三端交接和生产同步不能据此声称完成 |
| 正式 UI 与语言 | 原完整 Web 参考迁移到 Flutter；主导航、内容详情、编辑保护、首页/学习管理、语言切换与窄屏测试 | 原生 UI 优化当前暂停；组件/程序通过不等于 owner 全量视觉验收 |
| 自由练习 | 固定 scope、学习结果隔离、听力入口和播放器；macOS 实际播放及 Android fixture 各有边界 | 说/读/写仅获准未开放占位；不承诺所有地区/来源兼容 |

## 验收依据与复现

历史回归主体是 Rust 真实事务、TS/Rust 对照、Flutter 组件和 macOS/Android 独立进程恢复。
服务测试大多使用本机 HTTP/媒体替身及隔离 Postgres；部分有界模型/TTS 或真实播放试验不能外推为普遍质量保证。
以 `scripts/acceptance/catalog.mjs` 为执行入口，使用 `npm run sensa:acceptance -- plan <组 ID>`
查看依赖、脚本、替身和冷恢复条件。源码测试、集成脚本、fixture、schema 及 ADR 均未移除。

macOS 使用隔离验收库/Debug 身份；Android 恢复须保留安装数据，原记录常使用 `--no-uninstall`。
账号/Provider 测试还依赖安全存储签名及 loopback 服务；不能仅重新打开 ViewModel 就标记冷恢复通过。
程序通过、真实平台操作、owner 视觉确认、真实云端服务与商店发布分别记证据。

## 未关闭的总体验收

- 完整 Web 本地学习与资源下载、应用外壳断网冷启动、存储配额失败、导出与独立备份恢复。
- E2EE、密钥恢复/轮换、事实导入与并发调度裁决、三端同步；模型实验不是生产同步。
- 普通用户账号首次使用、默认 Sensa 服务、插件同账号权益和高级 Provider 入口。
- 真实托管邮件/鉴权、模型质量/成本、生产资源许可与发布、监控、CI/CD、签名/公证/商店。
- Windows/iOS/Linux 对应真机/安装验收；Android 模拟器不能代表所有目标平台。
- 四阶段正式 UI、完整资源治理/参考词典、未开放练习、历史归档分页与完整无障碍/输入法覆盖。

后续组已覆盖的早期缺口以上表为准，不能将早期 handoff 的“下一步”重新当作当前待办。

## 历史追溯

以下过程文件已从当前文档集移除。原文及精确测试次数、命令、临时日志位置和当时限制保留在
Git 基线 `64fad66603c493ff3c7880bf74e91a6769846f40`。需要审计某次交付时使用 `git show 64fad66603c493ff3c7880bf74e91a6769846f40:docs/sensa/<文件名>`。
临时 `/tmp` 日志不保证仍存在；Git 中的记录是当时的证据声明，本次清理没有重新执行平台验收。

- `native-activity-integration-handoff.md`
- `native-activity-integration-plan.md`
- `native-agent-group-handoff.md`
- `native-agent-group-plan.md`
- `native-anchor-use-handoff.md`
- `native-anchor-use-plan.md`
- `native-assurance-integration-handoff.md`
- `native-assurance-integration-plan.md`
- `native-assurance-lifecycle-handoff.md`
- `native-assurance-orchestration-handoff.md`
- `native-assurance-review-handoff.md`
- `native-four-stage-orchestration-handoff.md`
- `native-home-refinement.md`
- `native-intake-group-handoff.md`
- `native-intake-group-plan.md`
- `native-kernel-migration-handoff.md`
- `native-learning-organization-handoff.md`
- `native-learning-organization-plan.md`
- `native-local-learning-handoff.md`
- `native-localization-handoff.md`
- `native-navigation-refinement.md`
- `native-optional-resources-handoff.md`
- `native-optional-resources-plan.md`
- `native-pack-import-handoff.md`
- `native-personal-world-handoff.md`
- `native-personal-world-plan.md`
- `native-policy-handoff.md`
- `native-practice-refinement.md`
- `native-product-ui-handoff.md`
- `native-progress-journal-handoff.md`
- `native-progression-handoff.md`
- `native-pronunciation-handoff.md`
- `native-pronunciation-plan.md`
- `native-provider-group-handoff.md`
- `native-provider-group-plan.md`
- `native-provisioning-handoff.md`
- `native-provisioning-plan.md`
- `native-resource-group-handoff.md`
- `native-resource-group-plan.md`
- `native-retention-handoff.md`
- `native-runtime-scope-handoff.md`
- `native-runtime-scope-plan.md`
- `native-semantic-resolution-handoff.md`
- `native-semantic-resolution-plan.md`
- `native-study-refinement.md`
- `native-use-case-ux-refinement.md`
- `native-world-group-handoff.md`
- `native-world-group-plan.md`
