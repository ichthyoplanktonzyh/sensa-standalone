# Portable Lightweight Package v1

Portable Lightweight Package 是外部作者与 Sensa 轻量学习 Runtime 之间的公开接口。作者可以使用任意
编辑器、表格、脚本、Agent 或内部数据模型；Sensa 只接收最终的 `.sensa` 文件，不要求作者采用官方
生产中的 Target Core、Support Overlay、Luna 分工或批次目录。

## 文件形态

`.sensa` 是一个标准 ZIP 归档，但对普通用户始终表现为一个文件。内部只有公开 JSON 合同和原始媒体：

```text
example.sensa
├── package.json
└── media/
    ├── <sha256>
    └── <sha256>
```

`package.json` 的资源通过 `mediaId` 引用媒体清单；实际文件路径由摘要固定为 `media/<sha256>`，不是
作者可自由填写的路径。媒体以原始二进制保存，MIME 在清单中声明，不使用 Base64，也不要求文件扩展名。
因此普通用户仍然只分享一个 `.sensa` 文件，同时避免 Base64 的体积和解析开销。

裸 `package.json` 和对应的 `media/` 目录只是一种作者工作区，可供编辑器、脚本或第三方工具使用；
`.sensa` 是面向导入、私下分享和未来公共目录的唯一正式交换格式。

规范由以下实现共同定义：

- [`portable-lightweight-package-v1.schema.json`](schema/portable-lightweight-package-v1.schema.json)：供外部工具使用的 JSON Schema；
- `sensaPortableLightweightPackageSchema`：Sensa 使用的可执行合同；
- `validateSensaPortableLightweightPackage`：不访问网络、数据库、模型或 TTS 的公共准入校验器。

JSON Schema 由 TypeScript 合同机械生成，不能单独手改：

```sh
npm run sensa:package-schema
```

## 公共合同

一个 `.sensa` 文件只描述一个 Sense、一个目标表达和一条精确语言路线。它包括：

- 稳定的 Package UUID、正整数版本、标题、作者与许可；
- Target/Support Language Tag；
- 作者自己的稳定 Sense ID 和 learner-facing meaning；
- 目标表达、表达类型及可选合法变体；
- Lightweight 的六项核心资源；
- 适用时提供的可选资源；
- 被资源引用的媒体清单；媒体字节随归档携带。

外部 Sense ID 不要求来自 IDS，也不要求进入 Sensa 的官方 Semantic Registry。导入流程负责保留原始
Package identity 和来源；不能冒充已有官方 Sense 或通过自报字段获得官方信任。

六项核心资源是：

1. `experienceRecallCue`；
2. `targetExpression`；
3. `senseConfirmation`；
4. `pronunciation`，并引用已保存的真实音频字节；
5. `sceneBridge`；
6. `sceneRealization`，包含支持语言翻译和目标表达在例句中的明确 span。

经验资源可以是文字、图片或两者组合。图片不规定尺寸、比例、艺术风格或具体文件格式；公共校验只
要求媒体字节非空、声明为图片 MIME、摘要正确且引用存在。图片格式、尺寸、比例和风格均不作限制。
HTML 和自定义卡面不属于 v1。

## 公共校验与官方校验

公共校验只回答“这个包能否安全、完整地进入 Lightweight Runtime”，检查：

- Schema、必需资源和字段基数；
- 语言标签、Package identity 和版本；
- ZIP 路径、条目数量、展开大小和 `package.json` 大小；
- 媒体引用、媒体种类、原始字节、声明大小和 SHA-256；
- 发音所读 surface 与目标表达绑定；
- 例句 target span 位于文本内且非空。

公共校验**不检查经验提示是否泄露目标表达**，也不裁决语言是否自然、例句是否优秀或教学方法是否
符合 Sensa Official 的生产偏好。作者可以自由决定怎样教。官方内容另行运行更严格的生产与发布门禁；
通过公共校验不会自动获得 Community、Verified Creator 或 Sensa Official 身份。

本地检查与查看摘要：

```sh
npm run sensa:package -- pack path/to/authoring-directory path/to/package.sensa
npm run sensa:package -- validate path/to/package.sensa
npm run sensa:package -- inspect path/to/package.sensa
```

其中 authoring directory 使用与归档相同的 `package.json`、`media/<sha256>` 结构。打包器会重新计算
媒体大小与摘要、执行完整公共校验，并生成字节稳定的 `.sensa`；它不会访问网络、模型或 TTS。

## 字段审计结果

| 现有内部字段或约定 | Portable v1 处理 |
| --- | --- |
| Target Core / Support Overlay / Core digest | 不公开、不携带 |
| IDS Sense ID | 可使用，但不强制；作者可用自己的 ID |
| Edge TTS provider、voice、rate、文件名 | 不携带；只声明 recording/tts、来源和真实音频 |
| IPA | `phoneticNotation` 可选 |
| scene audio | 可选媒体；目标表达发音音频仍为必需 |
| visual value/status/brief/prompt policy | 属于生产过程，不进入可运行包 |
| research notes | 不作为运行必需；必要来源进入 metadata 或有来源的可选资源 |
| batch manifest、Core/Overlay 目录 | 不进入单包合同 |
| review status、官方认证 | 不能由作者自报，由导入来源或 Registry 赋予 |
| 媒体相对路径 | 不进入清单；归档路径固定由 SHA-256 推导 |

## 本地使用闭环

当前 Web 已在同一合同上完成本地闭环：

1. 用户选择 `.sensa` 后先执行只读校验和内容预览，不写入本地 Library；
2. 用户明确确认后才安装，安装本身不加入学习、不创建 Learning Target，也不产生进度；
3. 匹配当前 Target/Support Language Route 时，用户可以再明确加入学习，并直接复用正式 Lightweight Runtime；
4. 已安装的 Portable Package 可以重新下载为字节确定的 `.sensa`，媒体和公开清单保持可重建；
5. 重复安装相同制品幂等；相同 `packageId + version` 出现不同公开内容时拒绝覆盖，作者必须发布新版本；
6. 更高版本安装后只成为待应用更新，不自动改变课程；用户明确“应用更新”后，稳定的 Sense/Binding
   identity 继续使用原 Learning Target、Retention Target 和进度，并把新版材料作为当前材料；已经发生
   操作的 Step 保留当时材料，当前尚未操作的 Step 立即刷新，后续 Step 也使用新版；新 identity 创建新
   Target，旧 Target 不因新版缺少它而自动删除；
7. 产品界面只提供向更高版本更新，不以重新加入旧文件的方式静默回退课程版本。

导入时会把 Portable 合同编译为内部 Runtime material roles，但这是 Sensa 的消费实现，不成为外部作者
必须理解或采用的第二套制作合同。原始清单、公开 identity、摘要和媒体来源随安装记录保留；导出仍回到
同一个 `.sensa` 公开交换格式。

Portable Package 是分发与导入载体，不是 learner 长期学习身份，也不要求产品把每个旧版本永久建模为
可回放课程。长期身份属于 Learning Target，学习状态与当前 Material 分离；本机安装缓存的清理策略不属于
Portable v1 的公共合同。

尚未包含 Creator UI、复制后可视化编辑、自定义卡面和公共目录。这些能力继续建立在 `.sensa` 合同上，
不能要求外部作者采用 Sensa Official 的 Core/Overlay 生产结构。`.sensa` 本身不是 Learning
Materialization，不携带进度、调度、Evidence 或已经掌握的声明。
