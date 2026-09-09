# 原生学习组织整组推进

2026-09-09：Owner 要求按整组推进，组内验证后直接 checkpoint，不在 checkpoint 结束任务。
本组完成门为来源管理、正式 scope/Planner 接线、完整记录检索及桌面/移动离线恢复。

源码依据：apps/web/src/ui/BooksScreen.tsx 的词书/成员检索；experience 中的学习记录与统计投影；
现有 Rust Activity/Mixed/Review-only 与每日 Introduction；领域依据 learning-runtime-model.md §4、
product-requirements-v1.md §6.9。实际 Web 尚无 Book Enrollment/Range lifecycle 执行器，因此该部分
是落实已确认规则，不伪称逐行迁移。自由练习的 Practice Scope 属于独立 Runtime 组，不混入正式课程。

本组接口与所有权：
- Rust curriculum 管理本机不可变 Book manifest（引用已下载 Material）、Enrollment 的
  active/maintenance/paused、固定 ordinal/section/explicit range、补充学习来源与顺序。
- Book 版本升级显式进行，复用已存在相同 Target；不导入/覆盖新的 semantic contract 或 Policy Migration。
  semantic version 之间的 identity 演进仍受共同事实模型/Runtime 迁移门约束，不由 Book manifest 猜测。
- scope revision 保存去重成员、来源与计划引用；一次 Activity 固定其范围。活跃 Activity 中修改来源
  明确拒绝并让用户先结束/暂停；暂停 Activity 恢复原快照，新活动使用新 scope。
- 移除/暂停仅控制未来规划，不删除接受、Run、Outcome、FSRS 或个人语义世界；补充来源与 Book 去重。
- Rust history query 提供分页、时间/类型/表达过滤、日汇总和签到日历；只读真实完成事实，含独立材料入口，
  不凭 Activity 或最后一次 review 推断全部历史；不展示无可靠事实支撑的正确率/时长/掌握率。
- Flutter 提供“学习来源”和“学习记录”入口，消费本地 Query/Command，无账号/网络前置；沿用既有 Web
  搜索、状态、筛选、更多记录行为并适配手机。已确认的正式全站视觉/导航还归第 6 组。

验收覆盖换书与重叠目标、维护/暂停/恢复、范围缩小与旧工作、版本固定、补充移除/恢复/排序、
空 scope、已有暂停活动恢复、三 purpose 与每日额度、记录分页/过滤/隔离、v11 升级及原回执保留。
macOS/Android 独立合成库实测及冷启动；常规无 LLM/TTS，不迁移 owner 数据，不推送/部署。
