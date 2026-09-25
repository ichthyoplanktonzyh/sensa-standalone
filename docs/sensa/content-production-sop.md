# Learning Package Content Production SOP

> 状态：当前内容生产操作规范
> 更新日期：2026-09-24

本文定义 Sensa 轻量学习包的生产约定，包括 Sense 选批、Luna 分工、文本与媒体生产、确定性校验、失败恢复，以及同一目标语言材料在多个支持语言之间的复用方式。

本文是生产 SOP，不新增领域 identity，也不定义 Runtime、Learning Target、Materialization 或学习结果。发生冲突时，以 [`sense-learning-resource-model.md`](sense-learning-resource-model.md)、[`learning-connection-model.md`](learning-connection-model.md) 和当前代码合同为准。现有内容管线需要重构，因此不作为本 SOP 的实现前提；未来管线可以改变存储与编排，但不能悄然改变这里确认的生产职责和复用边界。

Target Core、Support Overlay 和本文的 Luna 分工只服务 Sensa Official 内部生产，不是外部作者合同。
外部作者只面对最终的 [Portable Lightweight Package](../../content/portable-lightweight-package.md)，可以用
任意方法制作通过公共 Runtime 准入校验的 `.sensa` 文件。

## 1. 生产目标与原则

学习包帮助 learner 从已经拥有的语言世界和生活经验，抵达目标语言中的表达。生产工作不是建立精细的语言学本体，而是为一个已经选定的 Sense 制作清楚、自然、可复用的学习材料。

生产遵循以下原则：

1. **Sense 先行**：先确定常见概念或体验，再选择目标表达和学习资源。
2. **单一作者完整交付**：同一个 Luna 负责一个 Sense 的文本、visual brief、TTS 和自检，避免重复理解上下文。
3. **默认使用 Luna high**：常规生产不再配置专职审核 Luna；复杂边界才提高推理等级或触发额外复核。
4. **机器校验不能省略**：模型能力替代不了 Schema、路径、引用、哈希和文件完整性检查。
5. **一 Sense 一生产单元**：单个 Sense 可以独立生成、校验、失败、重试和冻结。
6. **生成图片不设格式门槛**：不以尺寸、比例、文件格式或艺术风格拒绝生成图片，只验证资产完整性。
7. **目标材料优先复用**：目标表达、发音、目标语言音频和可复用图片不因支持语言变化而重复生产。
8. **支持桥接按语言重写**：经验提示、义项确认、场景连接、翻译和跨语言辨析随支持语言变化。
9. **可选资源不凑数**：只有在确实帮助理解、区分或使用当前表达时才加入。
10. **按需查资料**：普通、明确的 Sense 不进行形式化研究；有歧义、文化差异或低置信度时才查证。
11. **生产可恢复**：外部调用中断后只补缺失资源，不重新生成已经通过校验的内容。

## 2. 生产复用层

生产中使用两个复用层。它们是内容组织视图，不替代领域模型中的 Sense、Expression Binding、Support-Language Bridge 或 Learning Materialization。

### 2.1 Target Core

Target Core 的生产键为：

```text
Sense × Target Expression × Target Language
```

它保存通常可以跨支持语言复用的目标语言材料：

- 目标表达及表达类型；
- 目标语言发音事实、IPA 和目标表达音频；
- 默认目标语言场景实现及其音频；
- 目标语言自身的用法、构词和词源事实；
- 不依赖文字、能够跨语言复用的实体图或概念图；
- 来源、生成工具、提示策略和媒体 provenance。

作者文件中的 `visual_shared` 保存共享图片状态和媒体事实；图片说明文字由各语言的 Overlay 提供。

### 2.2 Support Overlay

Support Overlay 的生产键为：

```text
Target Core × Support Language
```

它保存从一种已有语言世界通向 Target Core 的桥接材料：

- 经验回忆提示；
- 当前义项确认；
- 经验与目标表达之间的场景连接；
- 目标语言场景实现的支持语言翻译；
- support/target 之间真实存在的覆盖范围与使用差异；
- 面向该支持语言 learner 的结构说明、助记和发音提示。
- 图片的 visual brief、alt text 等支持语言文字。

最终路线学习包由 Target Core 与一个兼容的 Support Overlay 组合而成。以英语为目标语言时，应理解为一份 English Target Core 加多份 Support Overlay，而不是复制多份完整英语材料。目标表达音频、默认例句音频和可复用图片只生产一次。

### 2.3 场景变体

默认情况下，各 Support Overlay 复用 Target Core 中的目标场景、图片和音频。如果某个支持语言共同体对默认场景很陌生，或该场景无法自然承载必要的跨语言边界，可以建立路线级场景变体。变体必须一起更新 experience cue、scene bridge、target-language realization、translation 及相关媒体，不能让第一张卡和第二张卡指向两个不同经验。

支持语言变化本身不重新定义 Sense，也不重新生成不受影响的目标表达发音和媒体。当前组合工具只处理默认目标场景；需要变体时，应先建立明确的目标场景版本，再让对应 Overlay 引用它，不能在 Overlay 中暗改共享 Core。

## 3. 学习包资源合同

当前轻量学习包必须提供六项核心资源。逻辑归属如下：

| 核心资源 | 默认生产层 | 说明 |
| --- | --- | --- |
| `experience_recall_cue` | Support Overlay | 用支持语言文字、图片或图文组合唤起经验，不披露目标表达 |
| `target_expression` | Target Core | 本次要建立连接的目标表达 |
| `sense_confirmation` | Support Overlay | 揭示后用一句话确认当前 Sense |
| `pronunciation` | Target Core | 真实目标语言声音及适用的发音事实；支持语言发音提示属于 Overlay |
| `scene_bridge` | Support Overlay | 说明为什么该表达适合刚才的经验 |
| `scene_realization` | Core + Overlay | 目标语言例句通常属于 Core，支持语言翻译属于 Overlay |

以下可选资源只在适用且内容可靠时加入：

- `recall_support`
- `language_structure`
- `usage_guidance`
- `boundary_contrast`
- `word_formation`
- `mnemonic`
- `etymology`

组合后的路线 JSON 仍由唯一的
[`lightweight-learning-package-authoring.schema.json`](../../content/schema/lightweight-learning-package-authoring.schema.json)
校验。作者分别使用 [`Target Core 模板`](../../content/templates/lightweight-target-core.template.json) 和
[`Support Overlay 模板`](../../content/templates/lightweight-support-overlay.template.json)。
[`split_lightweight_authoring.py`](../../content/tools/split_lightweight_authoring.py) 校验两者引用并组合；
不能在拆分文件中自行创造同义字段。

## 4. 工作区与文件约定

### 4.1 一 Sense 一份 Core、每种支持语言一份 Overlay

批次是任务分配单位，不是内容存储单位。目标语言材料和支持语言桥接分别保存：

```text
<authoring-root>/
  core/<target-language>/<sense-key>.json
  overlay/<target-language>/<support-language>/<sense-key>.json
  assets/
    images/
      <sense-key>.<ext>
    audio/
      <sense-key>.expression.<locale>.edge-tts.mp3
      <sense-key>.scene.<locale>.edge-tts.mp3
  materialized/<target>--<support>/
    packages/<sense-key>.json
    batch-manifest.json
```

`sense-key` 由稳定 Sense ID 机械转换，不能由作者自由命名。Overlay 持有 Core 的身份和内容摘要；Core 改动后须检查对应桥接内容，旧摘要不能自动更新。`materialized` 是从两份作者文件组合出的兼容格式，不作为另一份作者来源。旧的合并作者文件在迁移核对期间只读保留。

### 4.2 派生索引

`batch-manifest.json`、路线 JSON、整批 `packages.json` 和发布索引都由工具从 Core 与 Overlay 生成，不能人工维护，不能成为另一份内容来源。重新生成不得改写作者文件。

### 4.3 媒体路径

图片和音频只能写入 authoring root 的共享 `assets/` 目录。作者不能把媒体放在路线目录，也不能自定义目录层级。JSON 中使用相对于 authoring root 的稳定路径；组合与校验直接读取这份共享媒体，后续打包负责转换为正式内容寻址引用。

### 4.4 媒体元数据

作者负责提供源文本、visual brief 和生成意图。以下信息由媒体工具从真实文件自动写回，不能由 Luna 猜测或手填：

- MIME type；
- 字节数和尺寸；
- 时长；
- SHA-256；
- TTS 输入文本摘要；
- provider、voice、locale、rate 和生成配置；
- 最终相对路径。

图片的 MIME、尺寸和比例可以作为事实元数据记录，但不构成生成图片的格式门槛。

## 5. 角色与职责

### 5.1 主线程

主线程负责：

- 从候选集合中选择一个生产批次；
- 检查是否已有可复用 Target Core；
- 为每个 Sense 提供极简任务卡；
- 按语义关系把 Sense 分给互不覆盖的 Luna；
- 将容易混淆的对照项交给同一个 Luna；
- 提供固定路线 JSON Schema、Core/Overlay 模板、共享媒体目录和 TTS 配置；
- 汇总确定性校验结果，把失败项退回原作者；
- 生成派生索引并冻结通过校验的批次候选。

主线程不需要为每个 Sense 写语言学分析。普通任务卡只包含：

```json
{
  "sense_id": "ids:11-620",
  "idea": "暂时使用别人的东西，之后归还",
  "target": "borrow",
  "avoid": "不是把自己的东西交给别人使用",
  "target_language": "en",
  "support_language": "zh-CN"
}
```

`avoid` 只在明显容易串义时出现。

### 5.2 作者 Luna

常规批量生产默认由 Luna high 完成。一个 Luna 完整拥有分配给自己的单个 Sense 或一组紧密辨析 Sense。
图片生成不进入主生产关键路径，由后续增强批次统一处理。

作者负责：

- 首次生产一个 Sense 时生成 Core 和当前路线的 Overlay；已有 Core 时只生成新支持语言的 Overlay；
- 使组合后的路线包具备六项核心资源；
- 判断并生成真正有价值的可选资源；
- 只在必要时查询可靠语言资料；
- 判断图片的潜在价值并留下必要的 visual brief；
- 通过标准 Edge TTS 入口生成目标表达和目标例句声音；
- 运行作者自检；
- 根据确定性校验结果只修订失败的 Sense 或资源。

作者不能改变主线程给定的 Sense、目标表达或语言路线。发现输入存在根本问题时，应返回主线程处理，不能在生产中悄然改学另一个义项。

### 5.3 自动校验器

常规生产不配置专职审核 Luna。自动校验器是必需的生产关卡，且不得进行付费模型、图片或 TTS 调用。它负责验证：

- Core/Overlay 身份与摘要相符，组合后的 JSON 满足唯一规范 Schema；
- 六项核心资源齐全且位于规范字段；
- Sense ID、Target Core 和 Overlay 引用唯一且兼容；
- 媒体路径符合目录和命名规则；
- 所有引用文件存在、非空，格式与声明一致；
- 已绑定图片能够解码，文件摘要和字节数与引用一致；
- 音频时长、哈希、文本摘要和 TTS 配置与真实文件一致；
- `visual.value=none` 不携带图片引用，`ready` 图片必须有有效媒体；
- 批次索引可以从每个 Sense 的 Core 和 Overlay 作者文件无损重建。

Schema 或机械校验失败不需要新的审核者，直接退回原作者或由确定性工具修复。

### 5.4 例外复核

以下情况才临时安排额外 Luna 复核，不建立常驻审核流水线：

- 作者明确标记低置信度；
- 概念切分、亲属称谓、礼貌或文化边界复杂；
- 目标表达或例句存在多个同样合理的解释；
- 新增语言路线正在进行首批校准；
- 抽样检查发现同一类问题连续出现。

复核只解决被标记的问题，不重新生产整包。

## 6. 单批次生产流程

### Step 1：选批与分配

主线程选择 Sense，检查已有 Target Core，并按语义关系分组。`borrow/lend`、`hear/listen`、`see/look at`、`put on/wear` 等对照项交给同一作者，使边界在一次推理中保持一致。

每个 Luna 获得同一版：

- 极简 Sense 任务卡；
- 路线 JSON Schema、Core 与 Overlay 模板；
- visual value 与 brief 约定；
- Edge TTS voice、locale、语速和格式；
- 固定输出目录与命名规则。

### Step 2：文本生产

作者先完成 Core 中的目标语言内容，再完成当前 Overlay 中的支持语言内容。复用已有 Core 时，只写 Overlay：

1. 在 Core 写 target expression、pronunciation 与原创 scene realization；
2. 在 Overlay 写 experience recall cue 与 sense confirmation；
3. 写 scene bridge 和目标场景的支持语言翻译；
4. 只在有明显价值时添加 optional resources；
5. 自检同一包的所有资源是否仍指向同一个 Sense。

例句必须原创，不从词典或语料页面复制。资料来源用于核实语言事实，不把第三方示例改几个词后冒充原创。

experience recall cue 的文字场景遵循以下简单原则：

- 具体，不写成抽象定义；
- 能让 learner 在脑中构造或回想一种经验；
- 不提前泄露目标表达；
- 通常一到两句话；
- 只服务当前一个 Sense，不同时引入竞争概念。

文字场景不要求必须包含人物、物体、动作或状态。作者可以通过关系、感受、时间、空间、回忆或其他自然
方式唤起经验，不能为了套模板强行编造故事元素。

### Step 3：记录图片价值

文字场景本身是完整的经验呈现，不是图片失败后的降级版本。图片只是同一经验的可选视觉呈现。主生产
阶段不调用生图服务，只记录图片的潜在价值：

| `visual.value` | 含义 | 主生产状态 |
| --- | --- | --- |
| `high` | 图片会明显提高理解速度或体验感 | `deferred` |
| `normal` | 图片有一定增强价值，但文字已经足够 | `deferred` |
| `none` | 图片只是装饰、容易误导或价值很低 | `not_planned` |

`high + deferred` 和 `normal + deferred` 都是完整可用的学习包。后续图片增强批次读取 visual brief，统一
生成并将状态原子地改为 `ready`。图片生成失败、排队或耗时过长都不能阻塞学习包完成。已经生成且可用的
图片保持 `ready`，不需要删除或重新生成。

只有图片实际存在时，才进一步记录它承担 `primary` 或 `assisted` 角色。这个角色描述图片如何被使用，
不能替代 `value` 对增强价值的判断。

生成图片不要求统一画风、色调、渲染方式、人物风格、尺寸、分辨率、宽高比或图片格式。生产系统只要求：

- 文件存在、非空并且能够被正常解码；
- 路径、字节数和 SHA-256 与 JSON 引用一致。

生成服务返回的图片默认视为可用，不因构图、风格或格式差异反复重生成。visual brief、alt text 和应避免
内容在主生产时一并保存。准确性要求高且生成图片不可靠时，后续增强批次才考虑批准的开放素材来源，
并记录来源、许可和署名要求。`deferred` 不在产品中显示空占位。

### Step 4：TTS 生产

作者使用统一的 [`generate_lightweight_tts.py`](../../content/tools/generate_lightweight_tts.py) 入口生成：

- target expression 音频；
- scene realization 的目标语言音频。

voice、locale、rate 和格式由目标语言配置表决定，不由每个 Luna 临时选择。标准入口对 Core 文件生成音频并回写真实元数据；作者只提交已经冻结的 TTS 文本。Core 音频完成后再初始化新 Overlay 的 Core 摘要。

同一 Target Core 的音频只生成一次。切换支持语言时默认复用，不产生 17 份互相漂移的目标语言声音。

### Step 5：作者自检

作者提交前确认：

- 六项核心资源指向同一个 Sense；
- recall 阶段没有泄露目标表达；
- 目标例句包含目标表达或自然屈折形式；
- 支持语言自然，不是逐词翻译；
- `high` 或 `normal` 有足够简短、可供以后批量补图的 visual brief；
- `none` 没有伪造图片引用；
- TTS 朗读文本与当前 JSON 完全一致；
- optional resources 没有为了齐全而强行生成；
- 低置信度或文化边界问题已经显式标记。

### Step 6：确定性校验

主线程先用 [`split_lightweight_authoring.py`](../../content/tools/split_lightweight_authoring.py)
组合所需路线，再运行无外部成本的
[`validate_lightweight_authoring.py`](../../content/tools/validate_lightweight_authoring.py)，以 authoring root 为共享媒体根目录。校验器按单 Sense 报告结果，不能只返回整批成功或失败。失败报告必须包含 Sense ID、字段或文件位置、预期值和实际值。

### Step 7：局部修复与冻结

失败项退回原作者。修复只影响对应 Sense 和资源：

- JSON 结构失败不重生成媒体；
- 延后图片不属于主生产失败项；
- 缺失或文本摘要不匹配的音频只补相应音频；
- 已存在且校验通过的资源直接复用。

每个 Sense 的 Core 和 Overlay 作者文件都通过后，工具重新生成批次索引并形成不可变候选。作者输出和批次候选都不是 Published Package 或 Learning Materialization；发布、安装和 Materialization 仍按正式 Content Supply 流程进行。

## 7. 断点续作与幂等

每个 Sense 使用以下生产状态：

```text
assigned → text_ready → audio_ready → validated → frozen
```

`failed` 记录在具体阶段和资源上，不覆盖最后一个已成功状态。恢复时先读取对应的 Core、Overlay 作者文件和真实媒体：

- JSON 与媒体都有效：跳过；
- JSON 有效但音频缺失：只生成缺失音频；
- 音频输入摘要变化：只重生成受影响音频；
- 图片 brief 变化：不影响文字包完成，只使后续增强图片失效；
- 派生索引过期：直接重建，不重新生产内容。

外部调用必须支持有限次数的瞬时错误重试。重试不能改变 Sense、文本或已冻结配置，也不能覆盖另一个 Sense 的文件。

## 8. 查证策略

下列普通内容默认不搜索资料：

- 常见实体和动作；
- 意义与用法明确的高频表达；
- 作者高置信度且没有跨语言边界的原创例句。

出现以下情况时才查证：

- 同一表达有多个常用义项，容易选错；
- 目标语言没有直接对应词或通常使用短语；
- 搭配、介词、可数性、语域或礼貌程度不确定；
- 亲属、主食、住宅、服饰等概念切分受文化影响；
- 作者置信度不足。

查证以可靠词典、语料说明和权威语言资料为主。Oxford、COCA 等用于确认频率、搭配和用法，不复制其定义、例句或受版权保护的内容进入学习包。

## 9. 内容覆盖金字塔

IDS 提供 1,310 个可用于跨语言比较的条目。它们构成 Sensa 的完整跨语言 Sense 候选骨架；首批选定的 250 个 Sense 是其中高频、日常、适合轻量学习的优先子集，不能把 250 误写成 IDS 的完整规模。

IDS 条目具有共同的比较入口，不表示 1,310 项都同等常用、都在每种语言中词汇化为一个单词，或都应同时获得最高生产优先级。部分条目是低频工具、亲属细分、特定植物、法律、战争或宗教概念；某种语言可能使用一个短语自然表达，也可能暂时没有可靠材料。生产必须如实记录自然短语、表达缺失或资料不足，不能为了形式上的全覆盖编造一个单词。

内容覆盖按“语言广度”和“学习深度”形成金字塔。

### 9.1 IDS 1,310 多语言表达基础

这是覆盖最宽、内容最浅的一层。长期目标是每种受支持语言都为 1,310 个 IDS Sense 建立：

- 主要目标表达，或该语言中自然的描述性短语；
- 表达类型与必要的语言事实；
- 可获得时的发音；
- 可靠来源与覆盖状态；
- 没有可靠实现时的显式 missing/unavailable，而不是猜测。

这一层建立跨语言 expression coverage，不等于每条 Target/Support 路线已经拥有完整六项学习资源。

### 9.2 高频 250 完整轻量学习包

首批 250 个 Sense 是所有语言优先达到的完整学习覆盖层。它们应为每种目标语言建立可复用 Target Core，并为每种支持语言建立 Support Overlay，使具体路线能够组合出六项核心资源以及适用的可选资源。

这一层优先保证 learner 在任何已支持语言世界中，都能学习最常见的一组身体、行动、空间、关系、感知、认知和日常生活概念。图片、目标语言发音和适用场景应跨支持语言复用，不按语言对重复生成。

### 9.3 完整 IDS 学习包扩展

高频 250 稳定后，其余 1,060 个 IDS Sense 继续进入完整学习包生产。扩展顺序由语言路线需求决定：

- 常见路线优先完成全部 1,310 个 IDS Sense；
- 其他语言先保有 1,310 的表达基础，再逐批补齐完整包；
- 低频或文化相关条目可以晚于日常条目，但不能从完整候选骨架中消失；
- 适合复用的 Sense、图片、目标语言声音和支持语言 recall 继续按生产层组合。

最终目标可以是所有语言都拥有完整 IDS 覆盖，但发布节奏不要求每条路线同步达到相同深度。

### 9.4 常见路线的 IDS 之外扩展

少数高需求路线在完成或稳定扩展 IDS 后，可以继续使用 Oxford、COCA 等高频材料补足 IDS 不以现代语言学习为目标而缺少的内容，包括：

- 现代日常词汇；
- 高频短语与短语动词；
- 常用构式和话语表达；
- 语域、搭配与文化语用；
- 路线特有的学习难点；
- 多个典型场景和更深的复习、重学资源。

这些内容不要求同时覆盖所有语言。语言路线越接近金字塔顶部，覆盖的路线越少，但 Sense 数量、资源丰富度和路线针对性越高。

### 9.5 覆盖状态必须分开记录

“每种语言都有”至少包含三个不同状态，不能合并成一个布尔值：

| 覆盖状态 | 回答的问题 |
| --- | --- |
| Sense coverage | 该 Sense 是否进入共同候选骨架 |
| Expression coverage | 该语言是否已有可靠单词、短语或明确缺失状态 |
| Learning-package coverage | 某条 Target/Support 路线是否已有通过校验的完整学习资源 |

因此，一个语言可以已经完成 IDS 1,310 的 expression coverage，但只完成高频 250 的完整学习包；某条常见路线则可以进一步完成全部 1,310，并继续扩展到 IDS 之外。这种差异是内容金字塔的正常状态，不能伪装成所有路线已经同等完整。

## 10. 多支持语言扩产

完成首条 `target=en, support=zh-CN` 路线时，应同时识别并冻结可复用的 English Target Core 与中文 Support Overlay。扩展到其他支持语言时：

1. 复用 Sense、英语目标表达、发音、目标表达音频和适用图片；
2. 默认复用目标语言场景例句与音频；
3. 新作者只生成对应支持语言的 recall cue、confirmation、bridge、translation 和必要辨析；
4. 作者使用 Luna high 完成自检，复杂文化边界才提高推理等级或触发例外复核；
5. 只有场景确实不适合该语言共同体时，才建立完整场景变体并生成受影响媒体。

不能把“更换支持语言”实现为无条件重新生成整包。相同 Target Core 的媒体引用应保持稳定，避免形成 17 份互相漂移的英语发音、例句和图片。

## 11. 语言与文化差异的影响

文化与语言差异通常不改变 Sense 本身，而是改变 learner 从已有经验抵达目标表达的路径。

### 11.1 概念切分

不同语言会合并或拆分同一经验区域，例如英语 `uncle` 对应中文多个亲属称谓，英语 `put on` 可以覆盖中文的“穿”和“戴”。这类差异主要影响 Support Overlay 的 cue、bridge 和 boundary contrast。

### 11.2 典型经验与视觉原型

同一个 Sense 在不同共同体中最容易被哪种生活场景唤起可能不同。主食、住宅、服饰和家庭场景尤其明显。图片优先使用跨文化可识别的主体；文字提示可以使用支持语言共同体更熟悉的经验。视觉风格不同本身不构成问题。

### 11.3 语用与礼貌

请求、拒绝、称呼和人际距离不能依靠字面翻译。目标语言示例必须在目标语言中自然，Support Overlay 负责解释该表达在支持语言 learner 看来可能不同的礼貌程度和使用场合。

### 11.4 结构与学习难点

介词、冠词、可数性、方向、体貌和词序等难点取决于支持语言。`listen to` 是否需要专门提醒，或 `borrow` / `lend` 是否容易混淆，都不是目标语言材料对所有 learner 一概相同的属性。

### 11.5 发音提示

目标语言音频和 IPA 属于 Target Core，但发音教学提示可以按支持语言变化。不同语言背景的 learner 拥有不同音系经验，不能为所有支持语言复制同一套“母语者难点”。

### 11.6 场景与媒体覆盖

实体图和清楚的空间关系图通常可以复用。依赖亲属关系、借还方向、社会习惯或文字标牌的图片则可能无法跨文化独立表达，应使用支持文字或路线级场景变体，而不是让图片承担超出能力的语义。

## 12. 批量与并行建议

- 校准批次先使用少量 Sense，覆盖实体、动作、关系和跨语言边界。
- 普通作者任务建议一个独立 Sense，或一组必须一起辨析的两个 Sense。
- 同一作者完整生产 JSON、visual brief 与 TTS；图片在后续增强批次统一生成。
- 重要对照项交给同一作者，减少包之间的边界漂移。
- 自动校验可以集中运行，但必须按单 Sense 返回结果。
- 小批次稳定后逐步扩产，不因追求数量降低 Sense 一致性或媒体有效性。

## 13. 非目标

本 SOP 不要求：

- 为每个 Sense 编写精细语言学分析；
- 为普通批次配置专职审核 Luna；
- 统一所有图片的艺术风格；
- 为每个包强行生成七项可选资源；
- 为每个 Sense 配图；
- 使用 HTML 互动承载图片学习；
- 为每一种支持语言重复生成目标语言图片和 TTS；
- 让 Agent 的 JSON 直接成为已发布内容或 Runtime 可消费的 Materialization；
- 在本文中固定尚待重构的内容管线或长期存储实现。
