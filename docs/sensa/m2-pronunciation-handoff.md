# M2 按需材料的静态发音

2026-09-08 本地纵切通过。原文授权切片 checkpoint `7495b6af` 后继续 owner 已确认的音频范围。

按需任务创建时，从受控静态媒体目录按 exact accepted expression 的 SHA-256 解析发音，并
固定到 task/request。`reference_fact` → 已确认 target_expression candidate → pronunciation
的 objective derivation 分别保留来源；独立的确定性校验拒绝替换引用和丢失输入绑定。
材料只引用 `sensa-media:<digest>`，没有模型生成的 URL。Runtime 仍通过账号授权读取私有
Supabase Storage 对象，服务端和 Web 检查音频 digest。

`content/tools/consumer_pronunciation.py` 是显式、单表达的 edge-tts 生成候选工具；默认拒绝
外部调用。`--validate` 只读本地 MP3，检查文本 digest、文件 digest、大小与时长。输出 MP3、
manifest 和待审核 SQL 到指定的 Git 外目录；不自动上传或部署。正式发布静态对象和目录仍
走 CI/CD。已存在 manifest 时不自动重复生成。生成依据是已接受目标表达，不发送私人原文。

本切片完成静态发音生成候选和准备时解析复用，不声称云端存在自动 TTS 服务；未预备的表达
可无音频进入文字学习。原有 Web 在可选音频下载失败时会丢弃整份文本缓存，已修复；无音频、
下载/摘要失败与播放失败明确提示，可继续首学/复习/重学。回想阶段不展示音频，揭示后播放；
已下载音频随账号留在本机，支持离线播放。

验证证据：

- 一次 owner 已授权真实 edge-tts 调用，表达 `took`，Jenny en-US，默认速率；8,784 bytes，
  1,464 ms；digest `6076d56c91c2701519f9707cff4fc27ec6ecad31504d7ea5a8f78ceae534ecbf`。
  产物 `/tmp/sensa-m2-pronunciation/`，随后无成本 validator 通过。
- 只导入本地隔离测试 DB `sensa_m1a_m2_c`；production 未写入。
- Node/Deno provisioning checks：真实静态目录匹配、材料衍生、授权音频读取/摘要一致；
  no-cost contract 向量检查错音频引用、缺失表达候选来源被拒绝。
- Chrome 实际 Web：个人意义→加入→准备→回想隐藏发音→揭示→真实 MP3 离线播放；
  第二账号故意收到错误音频 bytes，显示不可用但完成文字学习。脚本
  `scripts/sensaPronunciationBrowserSmoke.mts`，截图 `/tmp/sensa-m2-audio-ready.png`、
  `/tmp/sensa-m2-audio-unavailable.png`。
- 根级 typecheck/build/lint、edge check 通过。普通 smoke 不会触发 TTS/LLM。

部署后的媒体对象、voice/license 策略和跨设备缓存验收仍属于托管发布工作。
