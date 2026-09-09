# 原生 Agent 协作组

Owner 于 2026-09-09 确认：澄清 Agent 是语言老师，以理解场景和自然表达为目标；只问影响实际
理解的歧义，足够就收敛。Focus 可选，用户不填写语义学表格。继承整组实施与 checkpoint 授权。

源依据：apps/web 的 semanticAgent/semanticAgentSession（chat + consolidate）与
contentAgentProvisioning/lightweightAgenticProvisioning（模型、白名单工具、Observation、提交、预算）。
迁移循环机制，补全旧慢轨的工具调用；不把单次图片识别当作完整澄清。

用例：图文材料 → 语言老师对话 → 必要追问/本机已知意思查询 → 可修改候选 → 明确确认进入 World；
显式入学 → 固定需求 → 本机工具/生成候选 → 独立审核 → 本机冻结并交给现有 Profile。
聊天和生成独立会话/权限/完成条件。图片只在选择支持图片的 provider 且用户明确发送材料时传出。

Rust agent 模块拥有版本化状态、固定输入、工具白名单、次数/超时、每次请求 identity、迟到拒绝、
用户暂停与显式恢复；schema15 加会话表，模型不写接受/学习事实。Dart 负责 HTTP、取消和 UI。
Provider 支持 OpenAI-compatible 自带 Key 及 Sensa 服务，设备配置与库事实分离；Key 仅驻留内存，
重启重新输入。Hono 只代理受鉴权/用量限制的模型调用，不保存个人会话，也不决定本机接受。

澄清只显示自然对话和简短意思/表达候选；修改候选用自然语言更正，重新生成的候选必须再确认。
失败/等待回答/预算耗尽/中断均保留本机记录，重启不自动发起付费重试。切换 provider 是显式选择。
内容生成复用固定目标、三次 attempt 上限与独立验证，不能降级 Profile 或写结果、日程、学习证据。

验收：固定无成本模型工具序列 + HTTP fixture、图文网络载荷、提问暂停/继续/修正、拒绝未授权工具、
重复/迟到/跨库/超时、旧学习不变、生成独立拒绝与修正、真实 macOS/Android 主链及独立进程恢复。
根级 typecheck/build/lint、Rust targeted/full tests/Clippy、Flutter analyze。无付费模型调用或部署。
