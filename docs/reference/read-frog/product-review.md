# 陪读蛙产品与源码参考评估

> 调研日期：2026-09-08。上游版本：1.46.8，固定提交 `e3cbe2b7c669c875dbf1b050254da9b628daefe1`。
> 性质：产品参考、owner 确认的方向与后续用例建议；不是详细实施合同，不修改 Sensa 当前里程碑。
> 方法：官网、使用文档、发布说明与扩展源码交叉阅读；未运行上游产品、测试或付费服务。
> 闭源边界：允许阅读源码理解行为；不复制、引入或逐段翻写上游实现、测试、提示词和素材。

## 1. 结论与定位

### Owner 已确认的方向（2026-09-08）

Sensa 面向眼睛能够接触到的各种真实场景，将用户想学习的内容连同上下文、目标 Sense 和表达带入统一的个人内容与学习系统。采集时尚未确定 Sense 的内容可先保留，之后补充和确认；保存与正式加入学习仍是独立动作。浏览器插件负责浏览器这个端口，其他应用与现实生活中的分享、截图、拍照等端口后续补充。

**YouTube 支持已明确纳入浏览器端口的产品方向，与网页阅读采集一起规划。**陪读蛙的字幕阅读、翻译、原位理解与保存体验均纳入采用范围；Sensa 还需保留视频来源及时间位置，让视频中的表达进入同一套意义确认和学习流程。下文先做已有字幕、再扩展转录及其他播放器形态的建议仅是交付分段，不将 YouTube 排除在浏览器范围之外。具体播放交互、兼容范围和交付里程碑随用例细化；本记录不表示功能已经实现。

### 调研结论

陪读蛙值得作为 Sensa 整条「从真实内容学习」旅程的主要产品参考。只参考划词弹窗，会漏掉它真正有价值的连接：在阅读现场理解内容，把理解结果整理为可保存的材料，再进入可持续复习。

不过，两点差异需要说得更准确：

- 陪读蛙已有自定义卡片正反面。Sensa 的差异应落到**学习方法可配置**：学哪些内容、经过哪些步骤、怎样判断完成，以及忘记后怎样重学。仅改变卡片展示字段，还不足以构成差异。[笔记库指南](https://www.readfrog.app/zh/docs/notebase-beta)
- 陪读蛙已覆盖网页、YouTube 和电子书阅读场景。Sensa 的多端方向应强调**浏览器、移动端分享、桌面以及后续图像/语音输入汇入同一个人的学习状态**，而非仅增加文件格式。[官网](https://www.readfrog.app/zh)

建议对外表达为：**从你正在阅读、观看和遇到的内容中留下想学的表达，再按适合自己的方式学会、复习和重新掌握。**这是 Sensa 的目标表达，不是对现有交付能力的宣称。

## 2. 陪读蛙的完整产品链

Owner 在本轮继续补充：LLM Provider 配置也纳入参考，并提出将保存材料之后的后处理排除后，整体参考其余体验。工作划分据此扩展为：**阅读/观看、翻译、解释、朗读、自定义动作、Provider 与阅读设置、材料选择与保存反馈，均进入体验参考范围；保存后的意义处理、学习内容准备、学习方式和复习运行以 Sensa 自身模型为准。**「进入参考范围」不等于承诺每项同时上线，也不表示复制源码、品牌素材或上游服务端实现。

保存是两部分的接合处：可以参考按钮、预览、操作步数和恢复体验；实际写入、来源保留、账号、本地队列及后续处理仍走 Sensa。下文的「最近/后续/暂缓」表示建议交付顺序，不排除某项作为完整产品参考。

| 阶段 | 查到的体验 | 对 Sensa 的意义 |
| --- | --- | --- |
| 继续消费内容 | 网页段落/全文翻译；视频双语字幕；电子书选择文本 | 用户不必先导入材料或离开原内容才开始学习 |
| 原位理解 | 划词、朗读、按上下文运行指令、结构化展示结果 | 先解决「这里是什么意思」，保存是后续选择 |
| 筛选和保存 | 将结构化结果保存到笔记库；候选笔记可勾选；保存状态可恢复 | 一次选择可发现多个表达，用户决定保留哪些 |
| 整理材料 | 笔记库字段、结果字段映射、卡片模板 | 内容与展示分离；同时要控制首次配置负担 |
| 持续复习 | 正面回忆、揭示答案、四级自评、安排后续复习 | 复习入口与下一步明确，让采集有后续价值 |

官网与笔记库文档说明用户旅程；扩展的[保存流程](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/entrypoints/selection.content/selection-toolbar/custom-action-button/use-save-to-notebase.ts)和[候选选择界面](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/entrypoints/selection.content/selection-toolbar/note-suggestion/note-suggestion-card.tsx)补充了入口、保存与恢复细节。不能把这张旅程表理解成所有操作都在扩展内部完成。

## 3. 哪些体验值得采用，哪些需要改造

这里的「采用」指用户可观察的行为，由 Sensa 独立实现。

| 能力 | 建议 | 在 Sensa 中的具体结果 | 优先级 |
| --- | --- | --- | --- |
| 轻量划词工具栏 | 沿用体验原则，补齐可靠性 | 选择后提供解释/朗读/保存入口；动作明确；关闭后继续阅读 | 最近 |
| 固定原选区与上下文 | 必须采用 | 用户复制解释、点击按钮、拖动面板时，仍操作原来的内容 | 最近 |
| 渐进解释 | 改造成学习用途 | 先呈现当前语境下的简明意思，再展开用法、辨析与例句；异步状态清楚 | 最近 |
| 原文/译文与朗读 | 采用基础交互 | 能比较原文和解释；发音失败不阻断理解或保存 | 最近 |
| 保存反馈与恢复 | 必须采用并接入现有本地队列 | 清楚区分已在本机保存、待同步、服务器已确认；失败后保留原文和用户选择 | 最近 |
| LLM Provider 配置与功能分配 | 纳入基础体验参考 | 添加连接、选择模型、测试状态、按功能指定模型；基础与高级设置分层 | 基础配置最近，扩展兼容随后 |
| 从长句发现多个表达 | 有选择地采用 | 给出可选候选，允许只保留一个；候选生成不等于用户接纳或加入学习 | 随后 |
| 自定义 AI 指令 | 收敛为学习操作 | 默认提供解释、用法/辨析等产品能力；高级配置后置，不能靠任意输出直接写学习进度 | 随后 |
| 笔记库字段与映射 | 借鉴灵活性，重做默认流程 | 普通用户无需先建表和映射字段；保存后能查看来源、整理与继续处理 | 随后 |
| 卡片模板及预览 | 采用可预览、可理解的配置体验 | 让用户看到选定学习方式的实际内容和步骤；模板只决定展示的一部分 | 随学习配置推进 |
| YouTube 字幕选词 | 独立纵切 | 字幕中选表达、理解、保存视频来源和时间位置，然后进入同一学习流程 | 紧接浏览器基础链 |
| 全文/段落翻译 | 段落优先，全文后置 | 先满足读不懂某段的需求；全文模式需额外承担动态网页、布局和请求规模 | 后续候选 |
| 电子书接入 | 借鉴适配方式 | 阅读器向共用理解/保存能力提供文本与定位信息 | 多端阶段 |
| 无字幕视频转录 | 单独评估与交付 | 提供异步准备、失败恢复和费用说明；不能视作已有字幕翻译的一个小开关 | 后续候选 |
| 站点开关、快捷键、设置恢复 | 按真实问题补齐 | 能关闭不适用站点、避免输入冲突、恢复设置 | 随可靠性推进 |
| 通用润色、时区换算、多模型比较 | 纳入完整参考池，交付后置 | 可参考自定义动作与比较体验；是否提供各个默认动作随用例决定 | 暂缓 |

上述排序是本次评估建议，不替代 owner 确认或[生产路线图](../../sensa/production-migration-plan.md)。底层架构仍以现有 Sensa 文档为准。

## 4. 最值得借鉴的交互细节

### 4.1 先理解，再决定留下什么

划词不应立即把用户带入一个必须填完的采集表单。默认保留阅读现场，用简短结果回答眼前问题，再提供「保存」以及后续「加入学习」的明确动作。

陪读蛙将结构化指令结果与保存连接起来；新的保存代码还支持未连接笔记库时进入创建/连接流程。因此不能仅根据较旧文档断言它要求所有用户先完成字段映射。Sensa 应进一步把默认保存路径做顺畅，把组织和高级配置留到需要时。[保存入口源码](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/entrypoints/selection.content/selection-toolbar/custom-action-button/use-save-to-notebase.ts)

对于较长选区，可以提供「你可能想留下的表达」。用户勾选候选后才执行保存；候选不足或没有值得提取的内容时，不为了展示结果强行产出。上游有可选候选生成与勾选 UI；在 Sensa 中是否开启、何时请求，需要按实际体验与成本决定。[候选生成](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/entrypoints/selection.content/selection-toolbar/note-suggestion/use-note-suggestion.ts)

### 4.2 保住用户正在处理的那一次选择

上游将面板所用选择与页面实时选择分开，并处理异步执行与取消。产品层面值得转成这些验收要求：

1. 在解释面板中复制文字，不会把原来想保存的词替换成解释文字。
2. 从选择 A 切到 B，A 的迟到结果不会覆盖 B。
3. 关闭、离开页面后，旧结果不会使面板重新出现。
4. 滚动、拖动、缩放与靠近屏幕边缘时，主要操作始终可见。
5. 输入框、页面按钮和视频控制操作不因残留选区误弹工具栏。
6. 弹窗、Shadow DOM、全屏和宿主页面事件不会轻易打断交互。

这些是从源码与测试阅读提炼的独立场景，未运行上游测试，也不复制其测试实现。[选择快照](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/entrypoints/selection.content/selection-toolbar/use-selection-popover-snapshot.ts) · [异步执行](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/entrypoints/selection.content/selection-toolbar/custom-action-button/use-custom-action-execution.ts) · [测试目录](https://github.com/mengxi-ream/read-frog/tree/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/entrypoints/selection.content/selection-toolbar/__tests__)

### 4.3 上下文既影响理解，也影响以后是否找得回来

上游能提取页面标题、描述和正文，用于上下文理解；这不意味着 Sensa 每次选择都应该提交整页。建议按句子、相邻段落、必要时扩展正文的顺序提供上下文，沿用 Sensa 原文使用授权，并让用户看到当前保存的内容范围。[网页上下文提取](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/utils/host/translate/webpage-context.ts)

Sensa 还需要把来源当作可回访的信息：网页 URL 与原句、视频及时间范围、电子书及章节/位置、图片及所选区域。它们是不同来源的定位需求，具体字段随用例细化。不能用模型重写的句子替代实际出处，也不能推定上游保存笔记时自动保留了全部定位信息。

### 4.4 保存的恢复能力比成功提示更重要

上游保存流程会检查账号、目标笔记库及字段映射，并保留待完成保存的快照。对 Sensa 的启发是：中断后应继续用户已决定的动作，而不是要求他再找一次原文。恢复前仍需确认操作属于当前账号和当前内容版本。[待保存状态](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/utils/notebase/pending-save.ts) · [连接校验](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/utils/notebase/connection.ts)

实现时继续使用 Sensa 自己的本地队列、幂等写入和账号恢复机制。上游的远程笔记保存实现不能直接替代我们的离线与同步约定。

## 5. YouTube：确实支持，但要分清三层

| 层次 | 已有证据 | Sensa 建议 |
| --- | --- | --- |
| 有字幕的视频 | 原文/双语/译文模式；字幕翻译与可选文本叠层 | 第一条视频用例从普通、有字幕的 YouTube 视频开始 |
| 视频学习交互 | 官网展示字幕查词与保存；源码包含字幕展示和视频适配生命周期 | 共用解释/保存能力，额外保留视频定位与播放状态 |
| 没字幕或自动字幕不准 | 1.46.0 发布说明及扩展请求代码支持云端 AI 转录 | 后续单独处理转录任务、准备时间、费用与失败；常规测试用固定字幕 |

来源：[字幕教程](https://www.readfrog.app/en/docs/video-subtitles) · [无字幕视频说明](https://www.readfrog.app/zh/blog/ai-transcription-subtitles) · [YouTube 适配](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/entrypoints/subtitles.content/platforms/youtube/config.ts) · [转录请求](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/utils/subtitles/ai/request-ai-subtitles.ts)

版本差异需要保留：旧字幕教程强调必须已有字幕，新发布说明已经增加 AI 转录。新说明还宣称支持直播回放，但当前扩展的 AI 请求入口会对 `isLiveContent` 返回真时拒绝请求，错误文案指向直播/回放不支持。因此直播回放的具体适用范围仍需真实视频验证，不能写成全部支持。[当前请求入口](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/entrypoints/subtitles.content/universal-adapter.ts)

第一条 Sensa 视频用例建议走到：**播放 → 选中当前字幕中的表达 → 原位解释 → 保存原字幕及时间位置 → 在 Web 找到 → 显式加入学习 → 以后能返回视频对应位置。**

需要先确认的播放体验包括：选择时是否自动暂停、关闭解释后是否恢复、跨字幕变化时如何保留所选原句。这些是 Sensa 的待设计项，本次没有足够证据认定陪读蛙已经采用某一种自动暂停方案。兼容验收再覆盖全屏、拖动进度、跳转到另一视频、广告和字幕不可用；Shorts/嵌入式播放器单独扩展覆盖范围。

## 6. Sensa 应保持自己的学习与采集结构

### 学习方式：配置用户怎么学

陪读蛙的可配置正反面解决「卡上显示什么」。Sensa 已有的领域与原型进一步定义学习步骤、内容要求、完成判断、首次学习/复习/重学及调度交接；这才是用户所说可配置记忆方式更有价值的延伸。[学习连接模型](../../sensa/learning-connection-model.md) · [当前策略原型](../../../apps/web/src/experience/learningRuntime/policyProfiles.ts)

建议把配置做成用户能理解的体验：先提供少量有明确学习目标和步骤预览的方式；展示材料是否就绪；开始后保留原方式和历史；不把表单、内部策略名称或任意步骤编辑器直接交给普通用户。原型已有选择界面，但当前生产范围仍以轻量链为主，不能宣称所有模式已完成生产迁移。[策略选择原型](../../../apps/web/src/experience/components/learning/LearningPolicyScreen.tsx) · [当前阶段](../../sensa/current-stage.md)

### 多端采集：入口增加，个人学习状态保持一致

陪读蛙的电子书选择桥接是有价值的参考：外部阅读表面可以把选中内容交给共用工具栏，不必再做一套解释/保存流程。不过，这只是官方网页阅读器的 iframe 桥接证据，不等于已有原生移动/桌面采集客户端。[电子书桥接](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/entrypoints/selection.content/external-selection-source.ts)

Sensa 的全局边界可以沿用既有模型：

- 来源适配负责取得用户选定的原文/媒体及来源位置。
- 采集流程负责保留、补全、解释和确认；不完整内容可先进入收件箱。
- 显式加入学习后，按选定方式准备材料并进入同一运行与复习链。
- 同一已确认意义与表达从多个来源再次出现，保留新的遭遇和出处；不按来源机械复制独立复习进度。

这些来自 Sensa 已有[个人语义世界模型](../../sensa/personal-semantic-world-model.md)及[生产架构](../../sensa/production-architecture.md)，不是通过参考产品新增领域规则。具体移动分享、图片 OCR、语音和桌面输入都应独立交付，避免一次性建设所有入口。

## 7. 建议的后续用例顺序

| 顺序 | 用户走通的结果 | 关键验收点 |
| --- | --- | --- |
| 1. 浏览器理解与保存 | 读到不懂的表达，理解后继续读；想留下时能可靠保存 | 原选区稳定、结果不串、重复保存不重复、离线/账号恢复、Web 可找到 |
| 2. 保存到学习的交接 | 从保存结果或收件箱确认意思，决定要不要学 | 保存/已确认/准备中/可开始区分；重试与返回原文；不隐式入学 |
| 3. 第一条视频链 | 有字幕 YouTube 选词，之后能学且能回到原视频位置 | 时间定位、字幕变动、播放/暂停、页面导航、全屏、字幕不可用 |
| 4. 学习配置体验 | 用户看懂所选方式会怎样学，并完成相应首学/复习 | 步骤预览、内容不足反馈、选择生效范围、已开始学习的版本保护 |
| 5. 第二种采集端口 | 同一个账号从另一端保存，随后在现有学习端继续 | 同一学习身份、不同来源定位、队列与账号隔离、跨端恢复 |

第 1、2 条已有部分实现，应围绕实际缺口继续验收而非重做；参见[浏览器阅读交付记录](../../sensa/m2-reading-interaction-handoff.md)。第 3–5 条是建议的新增工作顺序，需要先做对应前端用例确认再细化合同。全文翻译、批量候选、电子书专用阅读器和无字幕转录按反馈插入，不作为完成第一条闭环的前置条件。

## 8. LLM Provider 配置专项补充

参考重点是「连接管理 → 模型选择 → 功能分配 → 可用性反馈」，不只是一个 API Key 输入框。

| 配置层 | 上游证据 | Sensa 采用建议 |
| --- | --- | --- |
| Provider 连接 | 配置含名称、启用状态、密钥、地址；支持预置类型与兼容协议的自定义服务 | 提供易用的添加/编辑流程，常用服务预置，兼容服务可自定义 |
| 模型选择 | 预置模型、自定义模型标识；适用连接支持获取模型列表 | 保留手填入口；列表获取失败不应删除已经保存的模型 |
| 连接测试 | 主动发起实际翻译请求；显示成功、失败或较慢反馈 | 将连接测试作为显式动作；区分连通与任务能力，不在每次编辑时自动付费测试 |
| 按功能分配 | 网页翻译、字幕、划词翻译、输入翻译、笔记候选分别引用 Provider；自定义动作也有独立选择 | 先提供默认选择，再允许不同功能覆盖，便于平衡速度、质量与费用 |
| 能力匹配 | 普通翻译服务与 LLM 服务区分；结构化动作需要相应输出能力 | 不把「测试连接成功」显示成「所有功能可用」；错误应指向具体功能需求 |
| 高级参数 | 自定义 headers、provider options、temperature，以及适用服务的 reasoning 选项；高级区可折叠 | 按兼容能力展示，避免所有模型套同一张参数表 |
| 请求设置 | 网页与字幕分别配置请求节奏和批处理；失败重试、批次异常回退、去重和缓存 | 参考控制体验与失败场景；默认值按 Sensa 实测决定，不照搬上游额度或批量参数 |
| 本地模型 | 官方说明支持通过兼容接口接入 LM Studio 等本地服务 | 纳入接入方向；明确配置在哪台设备可用，不能把 localhost 设置当成跨端通用地址 |

源码依据：[配置结构](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/types/config/provider/schemas.ts) · [模型选择](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/entrypoints/options/pages/api-providers/providers-config/provider-config-form/translate-model-selector.tsx) · [连接测试](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/entrypoints/options/pages/api-providers/providers-config/provider-config-form/components/connection-button.tsx) · [功能分配](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/utils/constants/feature-providers.ts)

使用说明：[Provider 设置](https://www.readfrog.app/en/docs/api-key) · [自定义兼容服务](https://www.readfrog.app/en/docs/providers/openai-compatible-providers) · [请求控制](https://www.readfrog.app/en/docs/request-control) · [本地模型](https://www.readfrog.app/en/docs/providers/lm-studio)

接入 Sensa 时需独立确定四件事：哪些设置属于账号、哪些属于设备；密钥保存在哪里且不混入普通配置导出/日志；哪些请求从客户端执行、哪些必须经服务端；模型更换对进行中的解释与材料生成如何生效。普通阅读能力可配置 Provider，不意味着任意客户端模型结果可以绕过服务端的意义接纳、材料验证或学习结果规则。

本轮只确认把配置体验纳入参考，没有测试任何真实 Provider 或改动 Sensa 的密钥、调用路径和运行配置。具体支持列表及配置页面仍需按前端用例落地。

## 9. 不能从这次调研推出的结论

- 公开仓库足以研究扩展行为，但本次未取得 Notebase 完整服务端与复习调度实现，不能断言其使用某个具体算法或具有与 Sensa 相同的学习证据模型。
- [Google Drive 同步模块](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/utils/google-drive/sync.ts)同步的是配置；这不是整个笔记/复习数据离线同步能力的证明。
- 当前[通用侧栏入口](https://github.com/mengxi-ream/read-frog/blob/e3cbe2b7c669c875dbf1b050254da9b628daefe1/src/entrypoints/sidepanel/main.tsx)是尚待推出的占位页，不能据旧介绍把它列成成熟整篇伴读界面；视频专用侧栏与它不同。
- 官网将 PDF、漫画列为即将支持，本次没有将其列为已有能力。
- 源码审查能发现行为意图与防护案例，不能代替真实网站、账号、网络和播放器中的体验验收。本报告不声称已运行上游产品或完成 Sensa 对应功能。

后续独立实现时，以这份行为清单、已确认前端体验和 Sensa 领域文档为输入，记录采用的场景；不把上游源码当作移植底稿。

2026-09-08 实现进展：见[浏览器端口第一批交付记录](../../sensa/browser-port-handoff.md)。
该记录逐项对应本轮实际阅读的上游源码、独立实现、测试证据与未完成范围；本报告的调研结论不自动等同于功能已交付。
