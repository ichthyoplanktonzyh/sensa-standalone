# Sensa V1 Content Kernel Contract

> **状态**：Active versioned implementation contract；不属于领域模型  
> **日期**：2026-08-22  
> **实现范围**：`0001_sensa_baseline.sql` 与 Package Validator Module  
> **领域来源**：[sense-learning-resource-model.md](sense-learning-resource-model.md)  
> **后续依赖**：Curriculum、Learning Runtime 和 Sensa Sync migrations 只能引用本合同提供的稳定身份与发布版本。

本文记录 `sensa-package-validator-v3` 和当前数据库必须兼容的 delivery profile。文中的
资源数量是 V2 实现事实，不是 `Sense` 的本体定义；领域语义和分层以领域来源文档为准。

## 一、Module 与 Interface

Content Kernel Module 隐藏内容表、资源计数、条件资产匹配、发布完整性和不可变性。调用方只需要两个 Interface：

1. 读取一个已发布 Content Release 中的 Lexeme/Sense Package；
2. 使用 Package Validator 验证一个待发布 Sense Learning Package，并得到可持久化 Required Asset Manifest。

Package Validator 的外部 Interface 冻结为一个确定性函数：

```ts
validateSenseLearningPackage(candidate: SenseLearningPackageCandidate): PackageValidationResult
```

它不打开数据库、不调用 LLM/TTS、不写日志。数据库 Adapter 负责把行组装成 candidate，发布工作流负责持久化 result。测试与生产调用相同 Interface。

### 1.1 本地作者生产边界

本地内容生产只维护一个权威状态库：`content/data/senses.db`。Sense Inventory、
词典证据、词形、Build、Stage Attempt、事件和媒体缓存元数据都以 SQLite 行为准；
生产流程不读写 YAML 镜像，也不把工作目录中的 JSON candidate 当成状态。

`pipeline.py release` 生成的 JSON 与媒体目录只是通过 Package Gate 后的传输/导入快照，
可以从 SQLite Build 与内容寻址音频重新导出，不具备反向覆盖作者状态的权力。MP3 二进制
保存在 `content/data/media/audio/`，SQLite 只记录其 digest、路径与合成 provenance。

## 二、Standalone database boundary

`db/migrations/0001_sensa_baseline.sql` 是纯加法迁移，显式声明读取/修改 `sensa`、`content`、`pg_catalog`。它不能修改 `content.cards`、`content.review_events`、`catalog` 或现有 `sync` 类型。

### 2.1 冻结枚举

#### Content lifecycle

- `sensa.content_release_status`: `draft | approved | published | superseded`
- `sensa.content_review_status`: `draft | approved | rejected`
- `sensa.manifest_status`: `incomplete | satisfied | invalid`

允许的 release transition：

```text
draft → approved → published → superseded
draft/approved 可以保持原状态；不允许倒退或跳级。
```

#### Semantic and profile vocabulary

- `sensa.teaching_priority`: `core | extended | recognition`
- `sensa.relation_scope`: `intra_word | cross_word`
- `sensa.acquisition_need`: 使用冻结资源模型中的六个值
- `sensa.acquisition_primitive`: 使用冻结资源模型中的十一个值

Relation type 暂时使用非空 text + versioned validator，不在 baseline 中猜测尚未完成数据治理的闭合 ontology。

#### Asset vocabulary

`sensa.asset_kind`：

- `experience_sketch`
- `l1_bridge`
- `example`
- `pronunciation_audio`
- `study_example_audio`
- `boundary_note`
- `contrast_pair`
- `counterexample`
- `visual_grounding`
- `spatial_diagram`
- `causal_sequence`
- `temporal_sequence`
- `extended_audio`

`sensa.asset_capability`：

- `meaning_grounding`
- `l1_mediation`
- `usage_pattern`
- `contextual_variation`
- `pronunciation`
- `study_example_audio`
- `boundary_contrast`
- `counterexample`
- `visual_grounding`
- `spatial_grounding`
- `causal_grounding`
- `temporal_grounding`
- `extended_audio`

#### Example vocabulary

- `sensa.example_role`: `study | quiz`
- `sensa.example_construction`: `head_verb | nonfinite_verb | passive | subject | object | prep_object | predicative | modifier | adverbial`
- `sensa.scene_domain`: 使用冻结的十个场景域值

### 2.2 Release and stable identities

#### `sensa.content_releases`

- `content_release_id UUID PRIMARY KEY`
- `release_key TEXT NOT NULL`，同一发布系列跨版本保持稳定
- `version_number INTEGER NOT NULL CHECK > 0`
- `target_language TEXT NOT NULL`
- `learner_locale TEXT NOT NULL`
- `schema_version TEXT NOT NULL`
- `source_digest TEXT UNIQUE NOT NULL`，lowercase SHA-256 hex
- `status sensa.content_release_status NOT NULL DEFAULT draft`
- `validator_version TEXT`
- `capability_resolver_version TEXT NOT NULL`，当前只允许 `sensa-executable-learning-capability-resolver-v1`
- `created_at / approved_at / published_at / superseded_at TIMESTAMPTZ`
- unique `(release_key, version_number)`；`release_key` 本身不唯一，否则无法发布同系列的新版本

#### `sensa.lexemes`

- `lexeme_id UUID PRIMARY KEY`
- `language_tag TEXT NOT NULL`
- `lemma TEXT NOT NULL`
- `created_at TIMESTAMPTZ`
- unique `(language_tag, lemma)`

#### `sensa.lexeme_versions`

- `lexeme_version_id UUID PRIMARY KEY`
- `content_release_id` FK cascade while draft; published protection via trigger
- `lexeme_id` FK restrict
- `ipa_us / ipa_uk / syllables TEXT`
- `forms TEXT[] NOT NULL`，至少包含一个非空 form
- `frequency_rank INTEGER CHECK > 0`
- `created_at TIMESTAMPTZ`
- unique `(content_release_id, lexeme_id)`

#### `sensa.senses`

- `sense_id UUID PRIMARY KEY`
- `sense_key TEXT UNIQUE NOT NULL`
- `lexeme_id` FK restrict
- `created_at TIMESTAMPTZ`

#### `sensa.sense_versions`

- `sense_version_id UUID PRIMARY KEY`
- `content_release_id` FK
- `sense_id` FK restrict
- `sense_rank SMALLINT CHECK > 0`
- `part_of_speech TEXT NOT NULL`
- `guide_label_l1 TEXT NOT NULL`
- `definition_l2 TEXT NOT NULL`
- `teaching_priority sensa.teaching_priority`
- `register_label / domain_label / semantic_type / semantic_dimension / valency / semantic_note TEXT`
- `change_of_state / causative BOOLEAN NOT NULL`
- `inventory_version INTEGER CHECK > 0`
- `evidence_digest / identity_digest TEXT NOT NULL`
- `review_status sensa.content_review_status`
- `created_at / reviewed_at TIMESTAMPTZ`
- unique `(content_release_id, sense_id)`

同一 release 内 `(lexeme_id, sense_rank)` 的唯一性通过 stable `senses.lexeme_id` 与触发器/validator 检查，不能把同一个 rank 发布给同一 Lexeme 的两个 Senses。

### 2.3 Relations and Usage Patterns

#### `sensa.sense_relations`

- `sense_relation_id UUID PRIMARY KEY`
- `content_release_id` FK
- `source_sense_id / target_sense_id` FK restrict 且不得相同
- `relation_type TEXT NOT NULL`
- `scope sensa.relation_scope`
- `distinguishing_feature TEXT NOT NULL`
- `source_evidence_refs TEXT[] NOT NULL`
- `review_status`
- timestamps
- unique `(content_release_id, source_sense_id, target_sense_id, relation_type)`

Validator 确保 source/target 在同一 release 都有 approved Sense Version；`intra_word` 必须共享 Lexeme，`cross_word` 必须来自不同 Lexemes。

#### `sensa.usage_patterns`

- `usage_pattern_id UUID PRIMARY KEY`
- `content_release_id` FK
- `sense_version_id` FK
- `ordinal SMALLINT CHECK > 0`
- `canonical_pattern TEXT NOT NULL`
- `common_collocations TEXT[] NOT NULL DEFAULT '{}'`
- `register_label / domain_label / usage_restriction TEXT`
- `source_evidence_refs TEXT[] NOT NULL` 且不可为空
- `review_status`
- timestamps
- unique `(sense_version_id, ordinal)`

#### `sensa.usage_pattern_slots`

- `usage_pattern_id` FK cascade
- `ordinal SMALLINT CHECK > 0`
- `slot_name / semantic_role / value_description TEXT NOT NULL`
- `is_optional BOOLEAN NOT NULL`
- primary key `(usage_pattern_id, ordinal)`

### 2.4 Acquisition Profiles

#### `sensa.acquisition_profiles`

- `acquisition_profile_id UUID PRIMARY KEY`
- `content_release_id` FK
- `sense_version_id` FK
- `learner_locale TEXT NOT NULL`
- `schema_version TEXT NOT NULL`
- `acquisition_needs sensa.acquisition_need[] NOT NULL` 且不可为空
- `minimum_sufficient_experience TEXT NOT NULL`
- `distinguishing_features TEXT[] NOT NULL` 且不可为空
- `preferred_primitives sensa.acquisition_primitive[] NOT NULL` 且不可为空
- `required_asset_capabilities sensa.asset_capability[] NOT NULL`
- `optional_asset_capabilities sensa.asset_capability[] NOT NULL`
- `fallback_primitives sensa.acquisition_primitive[] NOT NULL`
- `domain_bound BOOLEAN NOT NULL`
- `domain_constraints TEXT[] NOT NULL`
- generator/prompt/source digest provenance
- `review_status`
- timestamps
- unique `(sense_version_id, learner_locale)`

Required 和 optional capabilities 不能重叠，由 CHECK/validator 保证。Profile 不含 learner state、固定 action sequence 或 `primary_exercise`。

#### `sensa.profile_boundary_targets`

- `acquisition_profile_id` FK cascade
- `sense_relation_id` FK restrict
- `ordinal SMALLINT CHECK > 0`
- `is_required BOOLEAN NOT NULL`
- primary key `(acquisition_profile_id, sense_relation_id)`
- unique `(acquisition_profile_id, ordinal)`

### 2.5 Common Asset identity and provenance

#### `sensa.learning_assets`

- `learning_asset_id UUID PRIMARY KEY`
- `content_release_id` FK
- `asset_kind sensa.asset_kind`
- `sense_version_id` nullable FK
- `lexeme_version_id` nullable FK
- `learner_locale TEXT`
- `content_digest TEXT NOT NULL`
- `source_evidence_refs TEXT[] NOT NULL`
- `generator_provider / generator_model / prompt_version TEXT`
- `source_license / source_attribution TEXT`
- `review_status`
- `created_at / reviewed_at TIMESTAMPTZ`

Ownership CHECK：

- `pronunciation_audio` 只绑定 `lexeme_version_id`；
- 其余 kinds 只绑定 `sense_version_id`；
- owner 与 asset 必须属于同一个 Content Release。

同一 release、kind、owner、digest 不得重复。

#### `sensa.text_assets`

一对一引用 `learning_asset_id`，只允许 `experience_sketch | l1_bridge | boundary_note`：

- `body TEXT NOT NULL`
- `sense_relation_id` nullable；Boundary Note 必须有 Relation，其他两类不得有

字符上限和目标词禁用规则由 Package Validator 检查，而不是用无法理解词形集合的 SQL CHECK 猜测。

#### `sensa.example_assets`

一对一引用 kind=`example`：

- `ordinal SMALLINT CHECK (ordinal > 0)`
- `text_l2 / text_l1 / target_form TEXT NOT NULL`; `disambiguating_cue / variation_note TEXT` 可选
- `target_start / target_end INTEGER`，满足 `0 <= start < end`
- `construction sensa.example_construction`
- `scene_domain sensa.scene_domain`
- `collocations TEXT[] NOT NULL DEFAULT '{}'`（应用层可省略，归一化为空数组）
- `role sensa.example_role`
- `context_l2 / context_l1 TEXT`
- unique `(sense_version_id, ordinal)` 通过 denormalized owner/触发器或复合约束保证

Study context、恰好 3 study/至少 3 quiz、target substring、以及已提供 cue/collocation 的
substring 声明由 Validator 检查；scene domain 分布不再是发布硬门槛。

#### `sensa.contrast_case_assets`

一对一引用 kind=`contrast_pair | counterexample`：

- `sense_relation_id` FK
- `positive_text_l2 / positive_text_l1 TEXT NOT NULL`
- `negative_text_l2 / negative_text_l1 TEXT NOT NULL`
- `distinguishing_feature TEXT NOT NULL`

#### `sensa.visual_assets`

一对一引用 kind=`visual_grounding`：

- `media_blob_id` FK `content.media_blobs` restrict
- `alt_text / distinguishing_feature TEXT NOT NULL`
- `source_license / source_attribution TEXT NOT NULL`

#### `sensa.diagram_assets`

一对一引用 kind=`spatial_diagram`：

- `figure_label / ground_label / path_description / topology / text_fallback TEXT NOT NULL`
- `start_description / endpoint_description TEXT`
- `contrast_relation_id` nullable FK

#### `sensa.sequence_assets`

一对一引用 kind=`causal_sequence | temporal_sequence`：

- `text_fallback TEXT NOT NULL`
- steps 保存到 `sensa.sequence_asset_steps(asset_id, ordinal, label, description)`，至少两步由 Validator 检查

#### `sensa.audio_assets`

一对一引用 `pronunciation_audio | study_example_audio | extended_audio`：

- `media_blob_id` FK restrict
- `source_example_asset_id` nullable FK；study audio 必填且来源 example role 必须为 study
- `accent_locale / provider / model / voice TEXT`
- `source_text_digest TEXT NOT NULL`
- `duration_ms INTEGER CHECK > 0`

Audio source digest 必须等于 Lexeme pronunciation source 或 Example text digest；Validator 负责语义校验。

Validator candidate 通过数据库 Adapter 同时读取 `content.media_blobs.sha256 / mime_type / size_bytes`；只提供 `media_blob_id` 不能证明媒体完整。Study/extended TTS 还必须有完整 provider/model/voice/accent provenance；真人 pronunciation 则必须有 source license 和 attribution。

### 2.6 Required Asset Manifests

#### `sensa.required_asset_manifests`

- `required_asset_manifest_id UUID PRIMARY KEY`
- `content_release_id` FK
- `sense_version_id` FK
- `acquisition_profile_id` FK
- `validator_version TEXT NOT NULL`
- `capability_resolver_version TEXT NOT NULL`
- `status sensa.manifest_status`
- `package_digest TEXT NOT NULL`
- `validated_at TIMESTAMPTZ NOT NULL`
- unique `(sense_version_id, acquisition_profile_id, validator_version, capability_resolver_version, package_digest)`

#### `sensa.manifest_requirements`

- `manifest_requirement_id UUID PRIMARY KEY`
- `required_asset_manifest_id` FK cascade
- `requirement_key TEXT NOT NULL`
- `capability sensa.asset_capability`
- `required_count / satisfied_count INTEGER CHECK >= 0`
- `status sensa.manifest_status`
- unique `(manifest, requirement_key)`

#### `sensa.manifest_requirement_asset_matches`

- requirement FK cascade
- `learning_asset_id` FK restrict
- primary key `(requirement, learning_asset_id)`

#### `sensa.manifest_requirement_usage_pattern_matches`

- requirement FK cascade
- `usage_pattern_id` FK restrict
- primary key `(requirement, usage_pattern_id)`

Manifest 只持久化 Validator 的可重现结果，不能由手工把 status 改成 satisfied。

### 2.7 Immutability, grants and RLS

- 所有表显式 schema-qualified；所有 ID、digest、nonempty text 和 cross-table release identity 都有约束或触发器。
- `backend_app` 获得 `sensa` schema usage 和内容读取权限，不获得直接 authoring DML；后续受控 publisher 使用数据库 owner/专用 SECURITY DEFINER Interface。
- 所有 Content Kernel 表启用 RLS；`backend_app` 只拥有 SELECT policy，并可读取 `published | superseded` 的不可变内容，使已经 pin 旧版本的 Study Plan 能继续运行。Catalog HTTP Module 只把 `published` release 暴露给新选择入口。
- release 进入 `published` 后，release metadata、所有 child rows、Asset rows、Manifest rows均不可 INSERT/UPDATE/DELETE；允许唯一后续 transition 是 release `published → superseded`。
- `approved → published` 前的数据库 trigger 至少要求：validator version 非空、Release 与每个 Manifest 使用同一冻结 Capability Resolver version、每个 approved Sense Version 有一个由同一 validator/Resolver tuple 产生且包含实际满足 requirements 的 `satisfied` Manifest、Manifest/Profile/release identity 一致，并且 release 内所有带审核状态的内容均为 `approved`。
- 删除 draft release 可以 cascade authoring rows；published/superseded release 不允许删除。

## 三、Package Validator Module

建议位置：`apps/api/src/sensa/content/packageValidator.ts`，公共类型放在同一深 Module 内，不拆成一组只做转发的浅文件。

### 3.1 Version

```ts
export const sensaPackageValidatorVersion = "sensa-package-validator-v3";
```

### 3.2 Result

Validator 返回：

- `status: incomplete | satisfied | invalid`；
- `validatorVersion`；
- `capabilityResolverVersion`；
- deterministic `packageDigest`；
- requirements：key、capability、required count、matched resource IDs、status；
- issues：稳定 code、path、message；
- 不包含异常堆栈或 LLM 原始输出。

Validator 在形成最终状态前调用 Learning Kernel 的
`ExecutableLearningCapabilityModule.resolve(packageSnapshot)`。这个 Interface 同时由 Encounter
使用，是 Package/Profile 需求、approved resources 与当前 Action/renderer vocabulary 的唯一
可执行性判定。Resolver 的 Interface 和每个结果都携带同一个冻结 version；Resolver 返回 unavailable 时，稳定 issue code 进入
`runtime.capability.*` family；validator 不在本模块复制另一套 Action 资源规则。

同一 candidate 的数组顺序不同但语义相同时必须产生相同 digest 和 requirement order。

Package digest 只覆盖内容身份、版本化内容与审核事实，不包含会在同一候选内容上变化的 Content Release lifecycle status 或当前 `validator_version` 字段；因此 draft/approved/published 状态转换本身不能改变 package digest。

### 3.3 Stable issue families

至少包括：

- release/profile/owner version mismatch；
- missing/unapproved Baseline Asset；
- duplicate singleton Asset；
- missing required sourced Usage Pattern；
- Example ordinal/count/role/context/domain/construction/span or supplied cue/collocation declaration failure；
- pronunciation/study-audio count或 source digest mismatch；
- missing required boundary target asset；
- missing Profile-conditional capability；
- runtime capability unavailable、ambiguous baseline 或 required capability 尚无端到端 Action/renderer 支持；
- invalid relation or cross-release reference；
- draft/rejected/failed media resource；
- placeholder/empty content。

TTS `source_text_digest` 的准确来源冻结为 UTF-8 原文 SHA-256：Pronunciation 使用 Lexeme lemma，Study Example Audio 使用对应 Example 的 `text_l2`。它不是整条 Example Asset 的 `content_digest`。

### 3.4 Baseline requirements

对一个 `zh-Hans` V3 candidate：

- exactly 1 approved Experience Sketch；
- exactly 1 approved L1 Bridge；
- Usage Pattern 可选；Profile required 时至少 1 条 approved、sourced Usage Pattern；
- 至少 6 approved Examples，ordinals 为唯一正整数；初始包恰好 3 study / 3 quiz，发布包恰好 3 study / 至少 3 quiz；历史 3+7 包兼容读取；
- study examples have contexts；scene domain 仅作描述性质量信息；
- at least 1 approved Pronunciation Audio on referenced Lexeme Version；
- exactly 3 approved Study Example Audio Assets，one for each study Example and matching its source digest；
- every Profile required capability is satisfied；
- every required boundary target has a Relation-backed executable Contrast/Counterexample resource accepted by the requirement。

若 Profile 声明 `boundary_formation`，或把 `boundary_contrast | counterexample`
列为 required capability，则至少一个 Relation-backed boundary target 必须标为
required。该 target 只能由当前 Runtime 可执行的 `contrast_pair | counterexample`
满足；只读 `boundary_note` 可以保留为内容，但不能单独让交互式 Boundary requirement
变成 `satisfied`。

### 3.5 Validation classification

- `invalid`：candidate 自相矛盾、cross-release、duplicate singleton、损坏 span/digest、非法引用；
- `incomplete`：结构合法但缺少 required/approved resources；
- `satisfied`：无 invalid issue 且所有 requirements 达标。

## 四、最小验证

本实现只增加关键 Module 边界验证，不追求单元测试覆盖率：

1. 一个通过公共 Validator Interface 的 complete Package fixture 返回 `satisfied` 和稳定 digest；
2. 同一 fixture 改变输入数组顺序仍返回相同结果；
3. 缺一个 study audio 返回 `incomplete`；
4. cross-release Asset 或损坏 target span 返回 `invalid`；
5. optional advanced media 不会被误报为当前可执行 primitive，required advanced media 在尚无
   端到端 Action/renderer 支持时返回 `runtime.capability.*` invalid issue；
6. Postgres integration 应用完整迁移链后，验证 published release child immutability、backend read-only grants 和关键 FK/CHECK。

当前五词内容可以作为数据来源，但不能伪造缺失的 Profile/Usage Pattern/audio 来让它“通过”；测试 fixture 是显式构造的合同 fixture，产品数据 validator 则应诚实报告缺口。
