# 原生静态发音与离线播放

2026-09-09。范围与接口见 [施工蓝图](native-pronunciation-plan.md)，行为依据为
[已有 Web 交付](m2-pronunciation-handoff.md) 及实际 material.ts / Web Runtime；未调用付费服务。

## 交付行为

个人意义轻量按需材料可固定 exact accepted expression 的受控静态发音。Hono 解析目录并将
pronunciation reference_fact 固定到请求，经过目标表达 candidate 的衍生、独立校验和 Rust
二次校验保存。目录查询最多等待 3 秒，无匹配/失败仍生成并接纳文字材料。
音频本身有最多 2 MiB 的流式下载限制、服务器与 Rust 双重大小/摘要检查；未取得账号访问权限
或目录表达摘要不匹配均不返回对象。服务器不为此保存用户的私人材料或 Context。

Flutter 在文字材料提交后尽力预取，失败不撤销文字就绪；揭示后可重新获取。
首学/复习/再学习共用固定 Material 引用；回想时不展示音频入口，揭示后可播放，离开即释放播放器。
没有静态资源、下载失败/损坏、解码失败都有明确文字提示，均能完成文字学习。
已缓存资源重启后不要求账号、Hono 或在线配置。缓存缺失/损坏可重试修复，不重复调用生成器。

本轮实测发现 audioplayers 的字节适配器在 macOS 临时缓存目录缺失时会直接写文件失败。
已建立 LocalAudioPlayer：创建自有临时目录、独立 .mp3 文件、正常释放时清理；轻量与高保证共用。
Android 解码失败后可能继续发送 completion，本轮也已验证失败提示不被该迟到事件覆盖。
SQLite 中的校验字节才是持久缓存，临时文件不是学习事实或用户数据的唯一副本。

## 数据兼容与范围

- Material 新增省略空值的 optional pronunciation；有音频 proof adapter 为 native-lightweight-v2，
  纯文本保留 v1。旧材料内容摘要、旧操作回执和 Run/Outcome/FSRS 不重写。
- 复用 schema v11 的 runtime_media。缓存写入不改变 library.revision，不产生 operation receipt、
  Evidence、学习计数或调度。内容/Run 仍不可变，缓存是可替换资源。
- v1 文本包仍只接受文字；高保证已有正式媒体导入保持原合同。
- 此处承接现有受控静态发音目录，不声称已实现任意表达的实时 TTS、发音变体消歧、资源治理、
  BYOK/provider 管理或完整离线媒体管理界面。原生首学/复习/再学习产品壳仍需正式 UI 迁移。
- 不迁移 owner 库、不上传数据、不部署、不产生新 TTS/LLM 调用。

## 验收记录

- `scripts/sensaNativePronunciationSmoke.mts`：无成本 Hono→Rust/SQLite，实际 FFmpeg 合成 MP3；
  错表达/错 sourceVersion、衍生候选来源缺失、非法 URL 等即使重算外围摘要仍被拒绝；
  授权读取、错误 bytes、跨库隔离、缓存损坏/重开/修复、三 purpose 固定引用与唯一学习历史。
- `scripts/sensaNativeProvisioningDatabaseSmoke.mts`：隔离 Postgres 的真实发布目录解析、摘要/表达绑定、
  撤销访问；同时回归配额、并发去重和取消竞态。媒体仅合成 fixture，执行后删除本轮静态目录行。
- `scripts/sensaNativeAnchorSmoke.mts`、`scripts/sensaNativeProvisioningSmoke.mts`：原文授权/替换、
  旧文本准备与真实 v10→v11 升级回归通过。
- `integration_test/pronunciation_test.dart`：macOS `mac-audio-03` 主流程 55 秒及独立启动 3 秒通过；
  已验证有效 MP3 的播放完成事件、真正解码失败、下载失败、无音频、隐藏/揭示、无服务配置播放。
  初期 mac-audio-01/02 暴露并定位临时目录问题，不计为通过。
- Android `android-audio-02` 主流程 48 秒、独立冷启动 10 秒通过；初次 android-audio-01
  暴露错误后 completion 覆盖提示，修复后重测通过。macOS 高保证 `mac-audio-assurance-01`
  使用实际 runtime artifact / 本地媒体回归 13 秒通过。
- Rust library 全部测试、workspace clippy（all targets/features，warnings denied）、原生 bridge
  locked check、Dart analyze、根级 typecheck/build/lint 全部通过。
- 本轮日志：`/tmp/sensa-audio-smoke-final.log`、`/tmp/sensa-audio-db-final.log`、
  `/tmp/sensa-audio-mac3.log`、`/tmp/sensa-audio-mac-cold.log`、`/tmp/sensa-audio-android2.log`、
  `/tmp/sensa-audio-android-cold.log`、`/tmp/sensa-audio-assurance-mac.log`。播放器对无效 MP3
  的 native error 日志是预期失败向量，最终 UI 断言和测试结果均通过。
  临时 macOS Debug bundle override 已还原，测试服务和本轮 adb reverse 已移除。

后续继续迁移学习组织的来源选择/Curriculum/Book Range，以及其余语义世界/采集交接和正式 UI。
完整已有能力仍按 [迁移清单](native-migration-checklist.md) 逐用例验收；Web 本地化、备份与可选
E2EE 同步属于后续新架构工作，不能由本轮音频或单设备缓存推导已经完成。
