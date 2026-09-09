# 个人语义世界迁移组合同

2026-09-09 owner 授权按整组推进；主代理直接实施，组内不停止请求继续。

源码依据：apps/web 的 PersonalMeaningComposer、personalMeaningJourney/mediaStore、gateway/
projection、SensaSemanticWorldScreen、ExpressionBindingScreen；既有原生 personal/semantic/
provisioning 是集成接缝。领域模型优先：不完整内容保持 Draft/Inbox，不沿用旧 gateway 的不完整
Personal Meaning 命名；Focus 可选，音频媒体在 Web 仍未交付，不能作为既有能力声称完成。

本组纵切：
1. 有序图文材料、熟悉表达、起点偏好、本机编辑草稿与冷恢复；保存与调用模型分离。
2. 从已知材料或已接受 Sense/Binding 确认完整上下文；同一上下文支持多个意义；已接受版本不可
   原地改写，复用编辑产生新草稿。文本线上解析继续复用既有入口；完整多模态模型请求属于第4组
   provider/资源协作，本组不伪装图片已被模型理解。
3. 已确认 Sense 的表达补充：typed expression、realizes/approximates/evokes、coverage 必须明确，
   新绑定身份与旧版本隔离；只对已有充分 semanticSpec 的来源提供后续按需学习资源能力。
4. 同一读模型的列表、展开、可缩放平移关系图、搜索/移除恢复/来源与绑定详情、显式入学交接。

Rust world 模块拥有草稿/媒体及接受事务，图片字节不进入 JSON 事实；schema14 只新增表。
World Command 共用库 CAS 和操作回执，但在正式 Activity 刷新/结算之前分流，不写学习进度。
接受仍落既有 personal_meanings，现有 practice/provisioning/learning 读取真实接受事实；图谱不造
Sense 关系、Evidence 或 Memory。外部模型不得直接写确认；新 binding 不沿用旧 material ready 状态。

验收：草稿失败/重启、图文持久化/摘要/隔离、未闭合不进 World、可选Focus、同Context多Sense与
同Sense多Binding、旧版本/材料/正式学习不变、跨库/乱序/幂等、schema13升级；macOS/Android
真实UI与独立进程恢复，无付费LLM/TTS。根级检查、Rust/clippy、Dart analyze、checkpoint。
