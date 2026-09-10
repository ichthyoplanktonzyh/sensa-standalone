# Web 本机意义、模型与学习工作流

2026-09-10。Owner 已确认先推进“记录一个意思 → 与老师澄清 → 确认保存 → 显式加入学习 →
生成与独立审核材料 → 开始学习”，并将 Provider 和本地持久化一起接入。复用正式 Web 的
外壳/组件及原生语言老师的已确认行为；不继续优化原生 UI。整组完成前不把局部交付称为本地学习闭环。

## 施工边界

- `apps/web/src/data/library`：浏览器本机库事务、命令去重、模型配置、会话/候选与确认；
  `drafts/providers/settings/operations/sessions/meanings/identities` 按对象分别保存，不使用整库 JSON。
- `experience/library/useLocalMeaningLibrary.ts`：无页面和路由的本机数据 hook，由完整
  `experience/App.tsx` 调用。新材料追加到原“我的内容”，原学习/收藏/笔记投影保持；
  原 `PersonalMeaningComposer` 提交本机文本，原澄清路由按 `meaningId` 读取本机会话。
  Provider 嵌入原 `/profile`，不替换学习偏好和计划回调。
- 模型 transport 在事务外执行；请求前固定 Provider、接收方、输入版本和租约，提交结果时重查。
- 共享 `semanticProposalSchema` 校验候选；接受创建稳定 Sense/Binding、两个 Anchor、Alignment
  与明确 Acceptance；同 semanticSpec/Expression 在当前库复用语义身份。未接受对话不建立意义。
- 后续 Curriculum、Content Task/Attempt/Bundle/Review、Material 和 Runtime 分表落账；
  保留共享合同与 TS/Rust 对照，不借原账号服务器给本地 Run 结算。
- 纠正前次交付：只复用组件、另建裁剪应用不满足 owner 的“完整应用”要求。
  已删除 `LibraryWorkspace`、`/local` 与 `?library=local` 专用入口；本次以 owner 指定
  `http://127.0.0.1:3000/profile` 所在完整应用为接入和走查对象。
  四项导航、学习偏好、学习计划保持原路径和逻辑；新本机资料不迁移或覆盖旧资料。
  旧学习实现仍是迁移期实现，本轮没有宣称其已完成生产化。生产账号应用入口也未被替换。

## 第一条纵切：材料、Provider 与老师确认

已实现：通过已有记录抽屉无账号本机保存文本材料、模型连接及三用途选择、仅页面内存中的 Key、老师的有界
工具循环（查询抽象意思/追问/提出候选）、自然语言更正、明确确认、对话重开与离线确认。
设置和重开不自动调用模型；一次“继续”最多 8 次请求，会话最多 24 次请求/40 次工具执行，
请求超时 45 秒、租约 60 秒。终结工具不能与其他调用同轮提交。错误/暂停不把内存结果当作保存成功。

原材料修改会使旧会话失去提交资格；旧记录仍可查看。Provider 的用途或连接版本改变时，旧
“发送”意图不能自动发给新接收方。响应不含合格候选、未授权工具、互斥终结、重复调用、
截断与超大响应均拒绝。Sensa gateway 复用现有无会话存储接口，令牌只发送到应用配置的服务地址。
未配置或无登录时明确失败；不因此要求用户登录才能保存/确认本机资料。

浏览器没有在本轮接入原生 OS 凭据库。Key 明确仅当前页面内存，刷新/关闭后重填；
公开连接和用途存 IndexedDB，Key 不进入操作账本或数据库。直接兼容服务受 Provider CORS 约束；
真实服务支持情况与真实模型质量尚未验收。本机图片入口当前禁用；图文、流式、参考来源、原文资源授权及加密凭据恢复仍待后续纵切。

### 已执行验证

`SENSA_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --import tsx scripts/sensaWebLocalJourneySmoke.mts`
配合隔离 loopback Vite（默认 3014、`VITE_SENSA_MODE=preview`，与 owner 完整应用入口一致）运行，真实 React 页面、Supabase 客户端模块、IndexedDB，
模型 HTTP 使用严格限定的确定性替身；其余外部请求拒绝，无真实模型/邮件/owner 数据。

- 普通 `/profile` 无专用参数即可显示 Provider；四项导航可见，原学习偏好修改与刷新恢复、
  原学习计划下钻通过。owner 的 3000 页面也完成只读走查（没有改动学习设置或录入测试资料）。
- 无账号保存材料；注入真实 IDB 写入失败后保持输入，不提示已保存；重试与刷新恢复。
- 保存 Provider 不调用模型；分别选择用途，Key 在页面内存、重开后不存在于凭据状态。
- 老师追问、自然语言更正、候选显示、重开不增加请求次数；离线能力以无新请求确认验证，
  尚非浏览器进程关闭后的断网应用冷启动验收。
- 核对数据库中有 Acceptance、没有 Key 或 Study Completion，确认不自动入学。
- 既有澄清页、确认层及设置页在 320/390/1280 宽度检查横向溢出，截图核对页面复用。

本轮根级 `npm run typecheck`、`npm run build`、`npm run lint` 全部通过；
本机页面流程与原账号跨标签隔离浏览器回归通过，模型调用均使用确定性替身。
回归已接入现有 consumer CI；修复共享学习者消息对比度，并验证追问在回答和刷新后保留。

本条切片尚未接通显式加入学习、内容生成、独立审核和学习结算；不能视为完整本地学习闭环。日常自动验证无成本；以上不是实际在线 Provider 或上线验收。
