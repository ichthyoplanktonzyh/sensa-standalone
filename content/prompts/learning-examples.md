# Sensa Learning Example Candidates

Produce a small candidate set for one specific Sense. Return one JSON object and no
Markdown: `{"examples":[...]}`. Generate exactly {{CANDIDATE_COUNT}} candidates for the
requested usage `{{DESIRED_USAGE}}`.

Each candidate contains:

```json
{"textL2":"","textL1":"","contextL2":null,"contextL1":null,"targetForm":"","usages":["study"],"construction":"head_verb","sceneDomain":"daily_life","disambiguatingCue":null,"collocations":[],"variationNote":null}
```

Use only a supplied verified target form, appearing exactly once as a whole word in
`textL2`. Chinese must not leak an English target form. A `study` candidate requires one
natural preceding context sentence in both languages. A `cloze` candidate normally uses
null contexts and must remain specific enough after the target is masked. Scene and
construction are descriptive labels, not diversity quotas. Optional cue/collocations must
be literal target-free substrings of `textL2`. Avoid events and sentence skeletons already
present in the existing set. Do not produce IDs, ordinals, spans, digests, status or audio.

Sense facts:
{{SENSE_FACTS_JSON}}

Acquisition Profile:
{{PROFILE_JSON}}

Approved grounding:
{{GROUNDING_JSON}}

Existing examples:
{{EXISTING_EXAMPLES_JSON}}

Repair instruction:
{{REPAIR_INSTRUCTION}}
