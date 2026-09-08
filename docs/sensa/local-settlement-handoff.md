# LF-0 / LF-1a 本地底座首步交付

日期：2026-09-08。对应 [迁移蓝图](local-library-migration-blueprint.md)与路线图 LF-0 / LF-1a。

## 完成范围

- 蓝图固定本地库、应用事务、纯领域内核、在线资源/模型、可选同步的职责，列出旧数据切换/回退与验收门。
- 从现有 consumer API 提取 `decideConsumerSettlement`，原 API 已消费它，FSRS 算法未改写。
- Initial hard/good 使用同一非证据性初始化；Review 保留 learner rating、due/revision 与 self_report；
  轻量 Relearning 不重评、不初始化 FSRS，again 保留 10 分钟等待。
- 固定调度 policy version 与参数集中在 Kernel；SQL、当前 Step/材料/授权检查、幂等账本和事务仍在原 API。
- 新增 Node/断网 Chrome 同向量 smoke，直接从公共函数接口验证决定，不在浏览器运行模拟后端。

## 验证证据

全部为本机无成本验证，未调用真实 LLM/TTS：

- `npm run typecheck`、`npm run build`、`npm run lint`、`npm run sensa:edge-check` 通过。
  lint 当前仍是仓库已有的类型检查别名；Web/web-next 的 chunk 大小警告仍存在。
- `SENSA_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run sensa:consumer-settlement-smoke`
  通过。独立 headless Chrome context 设置 offline；Node/浏览器各跑初学、三种复习评价、重学等待/完成、
  序列化后 Memory 恢复与非法输入向量，结果完全一致，浏览器没有网络请求。
  CI 可用已安装的 Playwright Chromium，或通过 `SENSA_CHROMIUM_PATH` 指向测试浏览器。
- 新建隔离库 `sensa_m1a_local_core_20260908`，应用 0001–0021；使用 `fixtureSql()` 的合成课程，未启用
  `SENSA_USE_GENERATED_TRIAL`。执行 `sensaConsumerAccountSmoke.mts --targets --initial --retention --checkin` 通过。
- 上述集成覆盖 M1-A–E：账号/数量、入学/材料、初学 Completion/Handoff 唯一性、quota 并发、到期身份、
  两安装冲突、一次 Outcome/FSRS、等待/重复重学、迟到上传及故障回滚。日志中的
  `Consumer request failed Error` 是注入事务故障的预期输出；最终进程退出码为 0。

## 证据限制与紧接工作

此提交完成共用结算提取，不是独立学习库的产品交付：

- 正式 Web 仍通过旧 Account/API/outbox；新本地存储和无账号入口未接入。
- 浏览器测试只证明 Kernel 可以断网执行；没有证明应用外壳断网冷启动或资料永久保存。
- 操作幂等/事务证据来自原 Postgres 适配器；本地 IndexedDB 需要独立验证崩溃、多标签页和配额失败。
- 未实现 E2EE、跨设备合并、备份恢复、Flutter 或旧数据导入；未变更 owner 学习数据、推送或部署。

下一纵切 LF-1b：以真实本地库应用模块接入已确认的学习界面，完成材料导入校验、显式入学、
离线新建/继续 Run、本地结果原子提交和重启恢复。库创建/资源导入与失败状态先形成可走查的界面，
沿用既有 Recall/Reveal/Review/Relearning 体验；不再新建一套简化学习页面。
