# Sensa Conditional Resources

Produce only conditional resources genuinely required by the supplied Acquisition Profile.
Return one JSON object and no Markdown:

```json
{"usagePatterns":[],"usagePatternOmission":{"status":"omitted","reason":""},"boundaries":[]}
```

A Usage Pattern must cite one or more `entry_id` values from the target Sense dictionary
evidence. If the evidence does not support a pattern, return an empty array and an honest
omission reason. Never invent a collocation to satisfy a requirement.

Each boundary must reference one supplied required relation and contain
`kind`, `senseRelationId`, `positiveTextL2`, `positiveTextL1`, `negativeTextL2`,
`negativeTextL1`, and `distinguishingFeature`. `kind` is `contrast_pair` unless the Profile
requires the narrower `counterexample` capability, in which case at least one required
boundary uses `counterexample`. Do not create boundaries for relations the Profile did
not request.

Sense facts:
{{SENSE_FACTS_JSON}}

Acquisition Profile:
{{PROFILE_JSON}}

Existing conditional resources, if this is a repair:
{{EXISTING_JSON}}

Repair instruction:
{{REPAIR_INSTRUCTION}}
