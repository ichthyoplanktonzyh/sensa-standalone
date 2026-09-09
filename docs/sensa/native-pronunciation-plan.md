# 原生静态发音纵切

2026-09-09；沿用 owner 已确认的 Web 行为，本轮不扩展内容或学习模型。

## 行为与边界

已接受 expression 按 exact UTF-8 SHA-256 查受控静态目录，准备请求固定 reference_fact，
经目标表达 candidate 的确定性衍生和独立校验进入不可变 Materialization。无匹配或目录不可用
仍准备文字材料；不调用 TTS。首学、复习、再学习在回想阶段不显示声音入口，揭示后可播放。
下载失败、摘要错误、解码失败均可继续文字学习；明确重试不重复生成文字材料。

Hono 的 `/sensa/native/content/prepare` 可返回带 pronunciation 元数据的
`native-lightweight-v2` adapter proof；纯文本仍为 v1。metadata 包含 digest、
sourceTextDigest、audio/mpeg 与 byteSize（最多 2 MiB）；媒体 URL 不由模型生成。
`GET /sensa/native/content/pronunciation/:digest?expressionDigest=...` 要求有效账号访问，
只读取受控目录中 exact digest + expression digest 的静态资源，读出后检查大小和摘要。
这是账号可用的静态资源服务，不依赖服务器存储私人 Materialization/Context；语义输入仍属于
已授权的语义/内容服务流程。模型 provider 扩展和资源发布治理另行迁移。

## 模块所有权

- `apps/api/src/sensa/provisioning/native.ts`：有界可选 lookup、固定 Request/Proof、静态下载路由。
- `apps/api/src/sensa/access/consumer.ts`：账号权限、静态目录数据库适配；复用私有 Storage reader。
- `crates/sensa-library/src/provisioning.rs`：复核角色、artifact/candidate 来源、版本、表达与 digest。
- `crates/sensa-library/src/pronunciation.rs`：不可变材料 reference + 可替换 SQLite byte cache；
  复用 runtime_media，不改 schema v11。cache 不属于学习事实，不创建 operation receipt 或 revision。
- Flutter repository/service：先读本机；缺失/损坏时有界下载、Rust 校验后持久化。准备完成时尽力预取，
  文字材料先提交；崩溃或失败可在揭示后重试。账号配置留在内存，离线缓存不要求服务配置。
- Flutter LocalAudioPlayer：平台临时播放文件，销毁时清理；原生库保存权威校验过的字节。
  PronunciationView 只挂在 reveal，离开时停止；高保证媒体复用同一播放适配器。

旧材料省略新增可选字段，内容摘要/旧 operation receipts 不被重写。v1 本地文本包仍只接受文字，
不顺带扩展其未经确认的媒体导入合同。播放和缓存不产生 Evidence/Outcome，也不重置 FSRS。

## 验收

无成本 Hono→Rust/SQLite smoke：正确/篡改 proof，错表达/错摘要，缓存损坏/修复、独立进程读取，
三 purpose 固定引用与唯一学习历史；隔离 Postgres 验证真实静态目录及访问撤销。
macOS/Android 实际界面：缺失、下载失败、损坏编码与真实合成 MP3 播放；回想隐藏、揭示播放、
无账号配置冷启动读取。只使用合成测试库，不迁移 owner 数据，不产生付费调用，不部署。
