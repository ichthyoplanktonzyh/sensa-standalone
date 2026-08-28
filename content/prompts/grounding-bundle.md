# Sensa Grounding Bundle

Write the two mutually consistent grounding resources for one English Sense. Return one
JSON object and no Markdown:

```json
{"grounding":{"experienceSketch":"","l1Bridge":""}}
```

`experienceSketch` is concrete Chinese experience text, at most 80 Chinese characters,
and must not contain the English lemma or any verified form. It is not a definition.
`l1Bridge` is natural Chinese, at most 60 Chinese characters, connects the existing L1
concept to this specific English Sense, and makes the important scope mismatch clear.
Do not write a semicolon-separated translation list. Do not drift into a sibling Sense.

Sense facts:
{{SENSE_FACTS_JSON}}

Acquisition Profile:
{{PROFILE_JSON}}

Existing bundle, if this is a repair:
{{EXISTING_JSON}}

Repair instruction:
{{REPAIR_INSTRUCTION}}
