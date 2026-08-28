"""No-cost semantic-structure checks for authoring attempts."""

from __future__ import annotations

import re
from typing import Any

from .model import issue

ACQUISITION_NEEDS = {
    "perceptual_grounding",
    "boundary_formation",
    "abstraction_invariant",
    "spatial_aspectual_tuning",
    "social_normative_calibration",
    "form_binding",
}
PRIMITIVES = {
    "visual_grounding",
    "motion_grounding",
    "spatial_relation",
    "causal_sequence",
    "temporal_sequence",
    "social_micro_scenario",
    "introspective_scenario",
    "contrast_pair",
    "counterexample",
    "contextual_variation",
    "production_cue",
}
CAPABILITIES = {
    "meaning_grounding",
    "l1_mediation",
    "usage_pattern",
    "contextual_variation",
    "pronunciation",
    "study_example_audio",
    "boundary_contrast",
    "counterexample",
    "visual_grounding",
    "spatial_grounding",
    "causal_grounding",
    "temporal_grounding",
    "extended_audio",
}
EXAMPLE_USAGES = {"study", "cloze", "transfer"}
CONSTRUCTIONS = {
    "head_verb",
    "nonfinite_verb",
    "passive",
    "subject",
    "object",
    "prep_object",
    "predicative",
    "modifier",
    "adverbial",
}
SCENE_DOMAINS = {
    "daily_life",
    "work_business",
    "study_school",
    "social_relations",
    "media_news",
    "travel_transport",
    "health_body",
    "tech_digital",
    "nature_environment",
    "arts_leisure",
}
SUPPORTED_CONDITIONAL_CAPABILITIES = {"usage_pattern", "boundary_contrast", "counterexample"}


def _text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _whole_word_spans(text: str, form: str) -> list[tuple[int, int]]:
    return [
        (match.start(), match.end())
        for match in re.finditer(rf"(?<![A-Za-z]){re.escape(form)}(?![A-Za-z])", text, flags=re.IGNORECASE)
    ]


def validate_profile(profile: Any, facts: dict[str, Any]) -> list[dict[str, Any]]:
    problems: list[dict[str, Any]] = []
    if not isinstance(profile, dict):
        return [issue("profile.not_object", "Acquisition Profile must be an object", stage="profile")]
    list_fields = {
        "acquisitionNeeds": ACQUISITION_NEEDS,
        "preferredPrimitives": PRIMITIVES,
        "fallbackPrimitives": PRIMITIVES,
        "requiredCapabilities": CAPABILITIES,
        "optionalCapabilities": CAPABILITIES,
    }
    for key, allowed in list_fields.items():
        values = profile.get(key)
        if not isinstance(values, list):
            problems.append(issue("profile.list_required", f"{key} must be an array", stage="profile", path=key))
            continue
        if key in {"acquisitionNeeds", "preferredPrimitives", "fallbackPrimitives"} and not values:
            problems.append(issue("profile.list_empty", f"{key} cannot be empty", stage="profile", path=key))
        unknown = [value for value in values if value not in allowed]
        if unknown:
            problems.append(issue("profile.value_unknown", f"Unknown {key}: {unknown}", stage="profile", path=key))
    for key in ("minimumSufficientExperience",):
        if not _text(profile.get(key)):
            problems.append(issue("profile.text_required", f"{key} must be non-empty text", stage="profile", path=key))
    features = profile.get("distinguishingFeatures")
    if not isinstance(features, list) or not features or any(not _text(value) for value in features):
        problems.append(issue("profile.features_invalid", "distinguishingFeatures must contain non-empty text", stage="profile", path="distinguishingFeatures"))
    required = set(profile.get("requiredCapabilities") or [])
    optional = set(profile.get("optionalCapabilities") or [])
    if required.intersection(optional):
        problems.append(issue("profile.capability_overlap", "requiredCapabilities and optionalCapabilities must be disjoint", stage="profile"))
    if not isinstance(profile.get("domainBound"), bool):
        problems.append(issue("profile.domain_bound_invalid", "domainBound must be boolean", stage="profile", path="domainBound"))
    constraints = profile.get("domainConstraints")
    if not isinstance(constraints, list) or any(not _text(value) for value in constraints):
        problems.append(issue("profile.domain_constraints_invalid", "domainConstraints must be a text array", stage="profile", path="domainConstraints"))
    if profile.get("domainBound") and not constraints:
        problems.append(issue("profile.domain_constraints_missing", "domainBound profile needs domainConstraints", stage="profile", path="domainConstraints"))
    relation_ids = {str(item.get("senseRelationId")) for item in facts.get("relations", [])}
    targets = profile.get("boundaryTargets")
    if not isinstance(targets, list):
        problems.append(issue("profile.boundary_targets_invalid", "boundaryTargets must be an array", stage="profile", path="boundaryTargets"))
    else:
        seen: set[str] = set()
        for index, target in enumerate(targets):
            relation_id = target.get("senseRelationId") if isinstance(target, dict) else None
            if relation_id not in relation_ids:
                problems.append(issue("profile.boundary_relation_unknown", f"Unknown boundary relation: {relation_id}", stage="profile", path=f"boundaryTargets[{index}]"))
            if relation_id in seen:
                problems.append(issue("profile.boundary_duplicate", f"Duplicate boundary relation: {relation_id}", stage="profile", path=f"boundaryTargets[{index}]"))
            seen.add(str(relation_id))
            if not isinstance(target, dict) or not isinstance(target.get("isRequired"), bool):
                problems.append(issue("profile.boundary_required_invalid", "Boundary target isRequired must be boolean", stage="profile", path=f"boundaryTargets[{index}].isRequired"))
        required_boundary_targets = [
            target
            for target in targets
            if isinstance(target, dict) and target.get("isRequired") is True
        ]
        requires_executable_boundary = (
            "boundary_formation" in set(profile.get("acquisitionNeeds") or [])
            or bool(required.intersection({"boundary_contrast", "counterexample"}))
        )
        if requires_executable_boundary and not required_boundary_targets:
            problems.append(issue(
                "profile.boundary_target_missing",
                "Boundary acquisition needs at least one required boundaryTargets relation",
                stage="profile",
                path="boundaryTargets",
            ))
    unsupported = sorted(required - SUPPORTED_CONDITIONAL_CAPABILITIES - {
        "meaning_grounding", "l1_mediation", "contextual_variation", "pronunciation", "study_example_audio"
    })
    for capability in unsupported:
        problems.append(issue(
            "profile.required_capability_unsupported",
            f"Pipeline cannot currently produce required capability: {capability}",
            stage="profile",
            path="requiredCapabilities",
        ))
    return problems


def validate_grounding(value: Any, facts: dict[str, Any]) -> list[dict[str, Any]]:
    problems: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return [issue("grounding.not_object", "Grounding bundle must be an object", stage="grounding")]
    sketch = value.get("experienceSketch")
    bridge = value.get("l1Bridge")
    if not _text(sketch):
        problems.append(issue("grounding.sketch_missing", "Experience Sketch is required", stage="grounding", path="experienceSketch", artifact_id="experience_sketch"))
    elif len(sketch.strip()) > 80:
        problems.append(issue("grounding.sketch_too_long", "Experience Sketch exceeds 80 characters", stage="grounding", path="experienceSketch", artifact_id="experience_sketch"))
    if not _text(bridge):
        problems.append(issue("grounding.bridge_missing", "L1 Bridge is required", stage="grounding", path="l1Bridge", artifact_id="l1_bridge"))
    elif len(bridge.strip()) > 60:
        problems.append(issue("grounding.bridge_too_long", "L1 Bridge exceeds 60 characters", stage="grounding", path="l1Bridge", artifact_id="l1_bridge"))
    if _text(sketch):
        leaks = [form for form in facts.get("validForms", []) if _whole_word_spans(sketch, form)]
        if leaks:
            problems.append(issue("grounding.target_leak", f"Experience Sketch leaks target forms: {leaks}", stage="grounding", path="experienceSketch", artifact_id="experience_sketch"))
    return problems


def validate_example(example: Any, facts: dict[str, Any], *, index: int = 0) -> list[dict[str, Any]]:
    problems: list[dict[str, Any]] = []
    path = f"examples[{index}]"
    artifact_id = example.get("candidateId") if isinstance(example, dict) else None
    if not isinstance(example, dict):
        return [issue("example.not_object", "Example candidate must be an object", stage="examples", path=path)]
    for key in ("textL2", "textL1", "targetForm"):
        if not _text(example.get(key)):
            problems.append(issue("example.text_missing", f"{key} must be non-empty text", stage="examples", path=f"{path}.{key}", artifact_id=artifact_id))
    usages = example.get("usages")
    if not isinstance(usages, list) or not usages or any(value not in EXAMPLE_USAGES for value in usages):
        problems.append(issue("example.usages_invalid", "usages must use study/cloze/transfer", stage="examples", path=f"{path}.usages", artifact_id=artifact_id))
        usages = []
    if "study" in usages and (not _text(example.get("contextL2")) or not _text(example.get("contextL1"))):
        problems.append(issue("example.study_context_missing", "Study candidate needs bilingual context", stage="examples", path=path, artifact_id=artifact_id))
    if example.get("construction") not in CONSTRUCTIONS:
        problems.append(issue("example.construction_invalid", f"Unknown construction: {example.get('construction')}", stage="examples", path=f"{path}.construction", artifact_id=artifact_id))
    if example.get("sceneDomain") not in SCENE_DOMAINS:
        problems.append(issue("example.scene_domain_invalid", f"Unknown sceneDomain: {example.get('sceneDomain')}", stage="examples", path=f"{path}.sceneDomain", artifact_id=artifact_id))
    text_l2 = example.get("textL2")
    text_l1 = example.get("textL1")
    target_form = example.get("targetForm")
    allowed = {str(value).casefold() for value in facts.get("validForms", [])}
    if _text(target_form) and target_form.casefold() not in allowed:
        problems.append(issue("example.target_form_unknown", f"Unverified targetForm: {target_form}", stage="examples", path=f"{path}.targetForm", artifact_id=artifact_id))
    if _text(text_l2) and _text(target_form):
        spans = _whole_word_spans(text_l2, target_form)
        if len(spans) != 1:
            problems.append(issue("example.target_occurrence_invalid", f"targetForm must occur exactly once; found {len(spans)}", stage="examples", path=f"{path}.textL2", artifact_id=artifact_id))
        all_spans = {
            span
            for form in facts.get("validForms", [])
            for span in _whole_word_spans(text_l2, str(form))
        }
        if len(all_spans) != 1:
            problems.append(issue("example.multiple_lexeme_forms", "Exactly one verified Lexeme form may occur", stage="examples", path=f"{path}.textL2", artifact_id=artifact_id))
    if _text(text_l1):
        leaks = [form for form in facts.get("validForms", []) if _whole_word_spans(text_l1, str(form))]
        if leaks:
            problems.append(issue("example.l1_target_leak", f"Chinese text leaks target forms: {leaks}", stage="examples", path=f"{path}.textL1", artifact_id=artifact_id))
    cue = example.get("disambiguatingCue")
    if cue is not None and (not _text(cue) or not _text(text_l2) or cue not in text_l2 or (_text(target_form) and _whole_word_spans(cue, target_form))):
        problems.append(issue("example.cue_invalid", "disambiguatingCue must be a target-free textL2 substring", stage="examples", path=f"{path}.disambiguatingCue", artifact_id=artifact_id))
    collocations = example.get("collocations", [])
    if not isinstance(collocations, list) or any(not _text(value) or not _text(text_l2) or value not in text_l2 for value in collocations):
        problems.append(issue("example.collocations_invalid", "collocations must be literal textL2 substrings", stage="examples", path=f"{path}.collocations", artifact_id=artifact_id))
    return problems


def validate_examples(value: Any, facts: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(value, dict) or not isinstance(value.get("examples"), list):
        return [issue("examples.not_array", "Example stage must contain an examples array", stage="examples")]
    problems = [problem for index, example in enumerate(value["examples"]) for problem in validate_example(example, facts, index=index)]
    selected = value.get("selectedCandidateIds")
    if not isinstance(selected, dict):
        problems.append(issue("examples.selection_missing", "selectedCandidateIds must be an object", stage="examples", path="selectedCandidateIds"))
        return problems
    by_id = {example.get("candidateId"): example for example in value["examples"] if isinstance(example, dict)}
    study_ids = selected.get("study") if isinstance(selected.get("study"), list) else []
    cloze_ids = selected.get("cloze") if isinstance(selected.get("cloze"), list) else []
    if len(study_ids) != 3:
        problems.append(issue("examples.study_selection_incomplete", f"V2 delivery needs 3 selected study examples; found {len(study_ids)}", stage="examples", path="selectedCandidateIds.study"))
    if len(cloze_ids) < 3:
        problems.append(issue("examples.cloze_selection_incomplete", f"V2 delivery needs at least 3 selected cloze examples; found {len(cloze_ids)}", stage="examples", path="selectedCandidateIds.cloze"))
    if set(study_ids).intersection(cloze_ids):
        problems.append(issue("examples.selection_overlap", "V2 compiler cannot assign one Example to both legacy roles", stage="examples", path="selectedCandidateIds"))
    for usage, ids in (("study", study_ids), ("cloze", cloze_ids)):
        for candidate_id in ids:
            candidate = by_id.get(candidate_id)
            if candidate is None or usage not in candidate.get("usages", []):
                problems.append(issue("examples.selection_invalid", f"{candidate_id} is not a valid {usage} candidate", stage="examples", path=f"selectedCandidateIds.{usage}"))
    return problems


def validate_conditions(value: Any, facts: dict[str, Any], profile: dict[str, Any]) -> list[dict[str, Any]]:
    problems: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return [issue("conditions.not_object", "Conditional resources must be an object", stage="conditions")]
    patterns = value.get("usagePatterns")
    boundaries = value.get("boundaries")
    omission = value.get("usagePatternOmission")
    if not isinstance(patterns, list):
        problems.append(issue("conditions.patterns_invalid", "usagePatterns must be an array", stage="conditions", path="usagePatterns"))
        patterns = []
    if not isinstance(boundaries, list):
        problems.append(issue("conditions.boundaries_invalid", "boundaries must be an array", stage="conditions", path="boundaries"))
        boundaries = []
    valid_evidence = set(facts.get("sourceEvidenceRefs", []))
    for index, pattern in enumerate(patterns):
        refs = pattern.get("sourceEvidenceRefs") if isinstance(pattern, dict) else None
        if not isinstance(pattern, dict) or not _text(pattern.get("canonicalPattern")):
            problems.append(issue("conditions.pattern_invalid", "Usage Pattern needs canonicalPattern", stage="conditions", path=f"usagePatterns[{index}]"))
        if not isinstance(refs, list) or not refs or any(ref not in valid_evidence for ref in refs):
            problems.append(issue("conditions.pattern_evidence_invalid", "Usage Pattern must cite target Sense evidence", stage="conditions", path=f"usagePatterns[{index}].sourceEvidenceRefs"))
    required_capabilities = set(profile.get("requiredCapabilities") or [])
    if "usage_pattern" in required_capabilities and not patterns:
        problems.append(issue("conditions.pattern_required", "Profile requires a sourced Usage Pattern", stage="conditions", path="usagePatterns"))
    if not patterns and not isinstance(omission, dict):
        problems.append(issue("conditions.pattern_omission_missing", "Empty Usage Patterns need an auditable omission", stage="conditions", path="usagePatternOmission"))
    valid_relations = {str(item.get("senseRelationId")) for item in facts.get("relations", [])}
    covered: set[str] = set()
    for index, boundary in enumerate(boundaries):
        relation_id = boundary.get("senseRelationId") if isinstance(boundary, dict) else None
        kind = boundary.get("kind") if isinstance(boundary, dict) else None
        if kind not in {"contrast_pair", "counterexample"}:
            problems.append(issue(
                "conditions.boundary_kind_invalid",
                "Boundary kind must be contrast_pair or counterexample",
                stage="conditions",
                path=f"boundaries[{index}].kind",
            ))
        if relation_id not in valid_relations:
            problems.append(issue("conditions.boundary_relation_invalid", f"Unknown boundary relation: {relation_id}", stage="conditions", path=f"boundaries[{index}]"))
        else:
            covered.add(str(relation_id))
        for key in ("positiveTextL2", "positiveTextL1", "negativeTextL2", "negativeTextL1", "distinguishingFeature"):
            if not isinstance(boundary, dict) or not _text(boundary.get(key)):
                problems.append(issue("conditions.boundary_text_missing", f"Boundary needs {key}", stage="conditions", path=f"boundaries[{index}].{key}"))
    required_targets = {
        str(target.get("senseRelationId"))
        for target in profile.get("boundaryTargets", [])
        if isinstance(target, dict) and target.get("isRequired") is True
    }
    for missing in sorted(required_targets - covered):
        problems.append(issue("conditions.boundary_required", f"Missing required boundary target: {missing}", stage="conditions", path="boundaries"))
    if "counterexample" in required_capabilities and not any(
        isinstance(boundary, dict) and boundary.get("kind") == "counterexample"
        for boundary in boundaries
    ):
        problems.append(issue(
            "conditions.counterexample_required",
            "Profile requires at least one counterexample boundary",
            stage="conditions",
            path="boundaries",
        ))
    return problems
