# 原生学习组织整组交付

2026-09-09。范围依据 [本组合同](native-learning-organization-plan.md)。

## 实现与来源

Rust schema v12 新增本机 Book/Enrollment、范围、补充学习来源与排序、来源过滤、不可变 scope
revision 及实际 Introduction 来源记录。Flutter 提供“学习来源”页面、词书/成员搜索与内容入口，
以及独立的“全部学习记录”页面。所有命令与查询走本机 Rust/SQLite，不要求账号或运行 Hono。

- 参考 `apps/web/src/ui/BooksScreen.tsx` 的词书、表达/意思检索、分页和内容导航；
  学习历史/统计参考 `experience/learningJourney/learningHistory.ts`、`learningStatistics.ts`。
- 当前 Web 没有完整 Book Enrollment/Range lifecycle 执行器。本轮换书、active/maintenance/paused、
  ordinal/section/explicit range 是落实已确认的 learning-runtime-model §4，不伪称旧 TS 源码直译。
- 导入轻量学习包自动登记本机词书；独立 `sensa-local-book-v1` manifest 可组织已下载材料，
  包括高保证 runtime artifact 的固定 Material 引用。manifest 不生成材料，不更换语义合同。
- 同一 Book/version 内容不可覆盖；新版本下载不自动切换 Enrollment。显式切换沿用相同 Target，
  旧 active 来源转为 maintenance，未开始内容停止引入，已开始的 Run 和历史保留。
- 来源过滤允许空集合；补充学习与词书在 Target 上去重，已有词书覆盖的目标不重复创建 Membership。
  来源顺序实际参与轻量与已注册高保证队列的规划，不只是 UI 排序。
- 进行中的 Activity 拒绝修改课程配置。暂停后可以调整；恢复旧 Activity 使用原 scope，
  “按当前来源开始新活动”使用新 scope，同时保留已开始的协议执行与学习事实。
- 范围缩小、暂停、移出补充来源不删除学习历史、Outcome、FSRS、Personal Meaning 或已接受的材料。
  新学/复习/再学习仍由原来的 Profile → 固定计划 → 注册执行器处理，额度在真实 Introduction 接受时消耗。
- 历史读取真实 Completion，包含独立材料入口。分页使用时间/ID 游标与库 revision；读取期间有新写入时
  提示刷新，避免翻页漏项。日期/类型/表达筛选、日汇总与独立签到日历不产生学习事实。

## 兼容与边界

旧版本升级仅添加课程投影与兼容来源，保留全部原回执。历史来源标明 legacy；不会倒推原始 Book
Introduction。旧 Activity 的成员仍以其原快照为准，不能借新 scope revision 重解释。

本轮没有迁移 owner 数据、双写历史、上传、部署或调用付费模型/TTS。Book 升级复用的是现有固定
Material/Target；跨 semantic version 的身份演进和多副本事实合并仍属于后续验收。

这是第 2 组的来源组织、Planner 接线和记录检索交付。正式全站导航、词书封面/词性元数据与状态徽标等
完整 Web 视觉承接仍在第 6 组登记；自由练习 scope 与正式 Curriculum 分开，继续属于 Runtime 组。
备份、E2EE 同步和 Web 本地执行均未由此完成。

## 验收

- `crates/sensa-library/tests/curriculum.rs`：换书与重叠 Target、维护/暂停/恢复、四种范围、
  旧活动恢复、版本冲突原子拒绝与显式升级、补充来源去重/排序/移除、空 scope、三 purpose 与额度。
  45 条完成记录分页为 40+5，验证日期/类型/表达筛选、跨库隔离、签到、过期游标与读取不写事实。
- `assurance_import.rs::book_selection_constrains_the_registered_structured_cohort`：实际高保证
  runtime artifact、Profile 与 Book Range，4 个下载目标仅有选中的 2 个进入队列，并遵守来源顺序。
- v11 及原有 v1/v2/v3/v4/v7/v9/v10 升级回归；原 Activity、Run、Outcome 与操作回执保留。
  旧版本模拟移除 v12 投影后再升级，既有事实单独比较，不把新增 scope revision 当历史事实。
- `integration_test/organization_test.dart`：macOS/Android 使用独立合成库，覆盖错误词书导入后纠正、
  成员搜索、非法范围提示、入学、学习/暂停/换范围/原活动恢复、首学完成、记录筛选、空来源和恢复。
  独立进程重开比较完整 snapshot，再读取词书范围与历史。Android airplane mode=1、wifi=0；无 Hono。
- 最终 Android `group2-android-verified` 主流程 36 秒、冷启动 11 秒通过；macOS
  `group2-mac-verified` 主流程 31 秒、独立冷启动通过，完整 snapshot 一致。
  先前桌面脚本暴露长列表懒加载与原生输入焦点定位问题，修正后主流程和冷启动通过；这些失败运行
  不算通过证据。页面搜索输入另使用持久 controller 和显式查询入口，范围编辑保留当前值。
- `cargo test --workspace --all-features`、workspace clippy（all targets/features、warnings denied）、
  原生 bridge locked check、Dart analyze，以及根级 `npm run typecheck/build/lint` 均通过。
- `scripts/sensaNativeProvisioningSmoke.mts`、`scripts/sensaNativeAnchorSmoke.mts` 无成本 Hono fixture
  与实际 Rust/SQLite 回归通过：准备中个人目标、显式入学、固定材料、Profile、授权撤销、迟到结果、
  替换后复习/再学习及 v10 升级。没有使用模型服务或真实 owner 数据。
- 本轮日志在 `/tmp/sensa-organization-*`；重要结果为 `rust-final.log`、`clippy-final.log`、
  `bridge-final.log`、`analyze-final.log`、`android-final.log`、`android-cold.log`、
  `mac-verified.log`、`mac-verified-cold.log`、`provisioning.log`、`anchor.log`。
  日志不入 Git；测试 Debug bundle override 在交付前还原，不影响 owner 已运行的 Release 应用。

本组完成后，原生迁移仍有第 1、3、4、5、6 组的未完内容。建议下一组先收口其余 Runtime scope
准入/自由练习规则，再继续个人语义世界；这不是剩余五次提交或固定百分比。
