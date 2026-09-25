# Lightweight authoring templates

轻量学习分别编辑一份 Target Core 和每种支持语言的一份 Support Overlay：

```text
<authoring-root>/
  core/en/<sense-key>.json
  overlay/en/zh-CN/<sense-key>.json
  overlay/en/ja/<sense-key>.json
  assets/audio/<sense-key>.*.edge-tts.mp3
  assets/images/<sense-key>.<ext>
  materialized/en--zh-CN/packages/<sense-key>.json  # 由工具生成，不人工编辑
```

[`lightweight-target-core.template.json`](lightweight-target-core.template.json) 展示目标表达、IPA、目标语言例句、声音和共享图片状态的结构。表达与例句音频只在 Core 中生成一次。主生产阶段图片仍使用 `deferred` 或 `not_planned`；已有图片可保留 `ready`。

Core 的文本及音频完成后，使用工具初始化 Overlay。工具会自动填入 Core 的校验摘要；作者再填写支持语言的经验提示、义项确认、场景桥接、例句翻译和图片文字。空字符串是待写占位，不能通过最终校验。[`lightweight-support-overlay.template.json`](lightweight-support-overlay.template.json) 是字段参考。

```sh
python3 content/tools/generate_lightweight_tts.py \
  <authoring-root>/core/en/ids-1-310.json --allow-external

python3 content/tools/split_lightweight_authoring.py init-overlay \
  --root <authoring-root> --target en --support ja --sense-id ids:1-310
```

完成后组合指定路线并运行无外部成本的最终校验。`materialized` 只是派生结果；媒体从同一 authoring root 读取，不为每条支持语言复制或硬链接一份。

```sh
python3 content/tools/split_lightweight_authoring.py assemble \
  --root <authoring-root> --target en --support ja \
  --output <authoring-root>/materialized/en--ja

python3 content/tools/validate_lightweight_authoring.py \
  <authoring-root>/materialized/en--ja \
  --asset-root <authoring-root> --stage final
```

Overlay 的 `core_ref.sha256` 锁定其对应 Core。Core 变更后，要检查经验提示和翻译是否仍与目标例句一致，再用 `core-digest` 读取新摘要并更新相关 Overlay；未更新的 Overlay 会被组合工具拒绝。

旧的 [`lightweight-learning-package-authoring.template.json`](lightweight-learning-package-authoring.template.json) 展示组合后的路线 JSON 结构，供兼容旧批次与校验器使用。新批次不再把它作为手写作者文件。
