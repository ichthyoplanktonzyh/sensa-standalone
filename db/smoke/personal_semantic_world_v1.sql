-- Run after all migrations. The transaction is always rolled back.
-- This proves the canonical Personal Meaning -> confirmation -> learning
-- connection path without creating persistent fixture data.

BEGIN;

INSERT INTO core.accounts (account_id, email)
VALUES ('psw-smoke-learner', 'psw-smoke@example.invalid');
INSERT INTO core.learners (learner_user_id)
VALUES ('psw-smoke-learner');
INSERT INTO org.workspaces (workspace_id, name)
VALUES ('10000000-0000-4000-8000-000000000001', 'PSW smoke');
INSERT INTO org.workspace_members (workspace_id, learner_user_id)
VALUES ('10000000-0000-4000-8000-000000000001', 'psw-smoke-learner');

INSERT INTO sensa.senses (sense_id, sense_key, lexeme_id)
VALUES (
  '10000000-0000-4000-8000-000000000002',
  'psw-smoke.borrow-temporary-possession',
  NULL
);

INSERT INTO sensa.sense_versions (
  sense_version_id,
  sense_id,
  version_number,
  version_origin,
  semantic_policy_version,
  semantic_spec,
  semantic_provenance,
  semantic_review_status
) VALUES (
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000002',
  1,
  'learner_confirmed',
  'sensa-semantic-policy-v3',
  '{
    "schemaVersion":"sensa-sense-semantic-spec-v1",
    "coreMeaningFocus":"暂时取得并使用他人的物品",
    "prototypeScenes":[{
      "summary":"朋友暂时把伞交给 learner 使用",
      "participantRoles":["owner","temporary possessor"],
      "states":["temporary possession"],
      "directionOrCausality":"owner to temporary possessor"
    }],
    "includedCases":["借入雨伞"],
    "excludedCases":["永久取得所有权"],
    "neighborContrasts":[],
    "openQuestions":[]
  }'::jsonb,
  '{
    "sourceKind":"learner_confirmed",
    "sourceReferenceIds":["psw-smoke-confirmation"],
    "generator":null
  }'::jsonb,
  'learner_confirmed'
);

INSERT INTO sensa.expressions (
  expression_id, expression_type, language_tag
) VALUES
  ('10000000-0000-4000-8000-000000000004', 'word', 'en'),
  ('10000000-0000-4000-8000-000000000005', 'phrase', 'en');

INSERT INTO sensa.expression_versions (
  expression_version_id,
  expression_id,
  version_number,
  surface_form,
  normalized_form,
  semantic_provenance
) VALUES
  (
    '10000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000004',
    1,
    'borrow',
    'borrow',
    '{"sourceKind":"learner_confirmed","sourceReferenceIds":[],"generator":null}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000005',
    1,
    'borrow something from someone',
    'borrow ... from ...',
    '{"sourceKind":"learner_confirmed","sourceReferenceIds":[],"generator":null}'::jsonb
  );

INSERT INTO sensa.sense_expression_bindings (
  sense_expression_binding_id, sense_id, expression_id, relation
) VALUES
  (
    '10000000-0000-4000-8000-000000000008',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004',
    'realizes'
  ),
  (
    '10000000-0000-4000-8000-000000000009',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000005',
    'realizes'
  );

INSERT INTO sensa.sense_expression_binding_versions (
  binding_version_id,
  sense_expression_binding_id,
  version_number,
  sense_version_id,
  expression_version_id,
  semantic_coverage,
  semantic_provenance,
  semantic_review_status
) VALUES
  (
    '10000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000008',
    1,
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000006',
    'exact',
    '{"sourceKind":"learner_confirmed","sourceReferenceIds":[],"generator":null}'::jsonb,
    'learner_confirmed'
  ),
  (
    '10000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000009',
    1,
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000007',
    'exact',
    '{"sourceKind":"learner_confirmed","sourceReferenceIds":[],"generator":null}'::jsonb,
    'learner_confirmed'
  );

SET LOCAL ROLE backend_app;
SELECT set_config('app.user_id', 'psw-smoke-learner', true);

INSERT INTO sensa.personal_meanings (
  personal_meaning_id,
  workspace_id,
  learner_user_id,
  created_by_operation_id
) VALUES (
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000013'
);
INSERT INTO sensa.personal_meaning_revisions (
  personal_meaning_revision_id,
  personal_meaning_id,
  workspace_id,
  learner_user_id,
  revision,
  display_label,
  provenance_kind,
  created_by_operation_id
) VALUES (
  '10000000-0000-4000-8000-000000000014',
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  1,
  '借伞时想表达的意思',
  'learner_authored',
  '10000000-0000-4000-8000-000000000013'
);

INSERT INTO sensa.meaning_focuses (
  meaning_focus_id,
  personal_meaning_id,
  workspace_id,
  learner_user_id,
  created_by_operation_id
) VALUES (
  '10000000-0000-4000-8000-000000000015',
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000016'
);
INSERT INTO sensa.meaning_focus_revisions (
  meaning_focus_revision_id,
  meaning_focus_id,
  personal_meaning_id,
  workspace_id,
  learner_user_id,
  revision,
  statement,
  provenance_kind,
  created_by_operation_id
) VALUES (
  '10000000-0000-4000-8000-000000000017',
  '10000000-0000-4000-8000-000000000015',
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  1,
  '暂时取得并使用他人的物品',
  'learner_authored',
  '10000000-0000-4000-8000-000000000016'
);
INSERT INTO sensa.meaning_focus_acceptances (
  meaning_focus_acceptance_id,
  meaning_focus_id,
  meaning_focus_revision_id,
  workspace_id,
  learner_user_id,
  operation_id,
  accepted_at
) VALUES (
  '10000000-0000-4000-8000-000000000018',
  '10000000-0000-4000-8000-000000000015',
  '10000000-0000-4000-8000-000000000017',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000019',
  now()
);

INSERT INTO sensa.personal_semantic_anchors (
  personal_semantic_anchor_id,
  personal_meaning_id,
  workspace_id,
  learner_user_id,
  created_by_operation_id
) VALUES (
  '10000000-0000-4000-8000-000000000020',
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000021'
);
INSERT INTO sensa.personal_semantic_anchor_revisions (
  personal_semantic_anchor_revision_id,
  personal_semantic_anchor_id,
  personal_meaning_id,
  workspace_id,
  learner_user_id,
  revision,
  anchor_kind,
  language_tag,
  body_text,
  provenance_kind,
  created_by_operation_id
) VALUES (
  '10000000-0000-4000-8000-000000000022',
  '10000000-0000-4000-8000-000000000020',
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  1,
  'text',
  'zh-Hans',
  '朋友在下雨时把伞暂时给我使用。',
  'learner_authored',
  '10000000-0000-4000-8000-000000000021'
);

INSERT INTO sensa.personal_expression_anchors (
  personal_expression_anchor_id,
  personal_meaning_id,
  workspace_id,
  learner_user_id,
  created_by_operation_id
) VALUES (
  '10000000-0000-4000-8000-000000000023',
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000024'
);
INSERT INTO sensa.personal_expression_anchor_revisions (
  personal_expression_anchor_revision_id,
  personal_expression_anchor_id,
  personal_meaning_id,
  workspace_id,
  learner_user_id,
  revision,
  expression_type,
  language_tag,
  learner_language_role,
  surface_form,
  normalized_form,
  provenance_kind,
  verification_status,
  created_by_operation_id
) VALUES (
  '10000000-0000-4000-8000-000000000025',
  '10000000-0000-4000-8000-000000000023',
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  1,
  'word',
  'en',
  'target',
  'borrow',
  'borrow',
  'learner_authored',
  'learner_confirmed',
  '10000000-0000-4000-8000-000000000024'
);

INSERT INTO sensa.sense_constructions (
  sense_construction_id,
  workspace_id,
  learner_user_id,
  personal_meaning_id,
  personal_meaning_revision_id,
  meaning_focus_id,
  meaning_focus_revision_id,
  familiar_language_tag,
  target_language_tag,
  semantic_policy_version,
  created_by_operation_id
) VALUES (
  '10000000-0000-4000-8000-000000000026',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000014',
  '10000000-0000-4000-8000-000000000015',
  '10000000-0000-4000-8000-000000000017',
  'zh-Hans',
  'en',
  'sensa-semantic-policy-v3',
  '10000000-0000-4000-8000-000000000027'
);
INSERT INTO sensa.sense_construction_turns (
  construction_turn_id,
  sense_construction_id,
  workspace_id,
  learner_user_id,
  ordinal,
  actor,
  body,
  output_digest,
  occurred_at
) VALUES (
  '10000000-0000-4000-8000-000000000028',
  '10000000-0000-4000-8000-000000000026',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  1,
  'learner',
  '我关心的是借入，不是借出。',
  repeat('a', 64),
  now()
);
INSERT INTO sensa.sense_proposals (
  sense_proposal_id,
  sense_construction_id,
  workspace_id,
  learner_user_id
) VALUES (
  '10000000-0000-4000-8000-000000000029',
  '10000000-0000-4000-8000-000000000026',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner'
);
INSERT INTO sensa.sense_proposal_versions (
  sense_proposal_version_id,
  sense_proposal_id,
  workspace_id,
  learner_user_id,
  version,
  meaning_focus_revision_id,
  semantic_spec,
  expression_candidates,
  semantic_policy_version,
  generator_provenance
) VALUES (
  '10000000-0000-4000-8000-000000000030',
  '10000000-0000-4000-8000-000000000029',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  1,
  '10000000-0000-4000-8000-000000000017',
  '{"schemaVersion":"sensa-sense-semantic-spec-v1"}'::jsonb,
  '[{"surfaceForm":"borrow","languageTag":"en","expressionType":"word"}]'::jsonb,
  'sensa-semantic-policy-v3',
  '{"provider":"smoke","model":"smoke","promptVersion":"v1"}'::jsonb
);

INSERT INTO sensa.sense_proposal_confirmations (
  sense_proposal_confirmation_id,
  operation_id,
  workspace_id,
  learner_user_id,
  sense_proposal_version_id,
  meaning_focus_revision_id,
  resolution,
  sense_id,
  sense_version_id,
  confirmed_at
) VALUES (
  '10000000-0000-4000-8000-000000000031',
  '10000000-0000-4000-8000-000000000032',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000030',
  '10000000-0000-4000-8000-000000000017',
  'create_new',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  now()
);
INSERT INTO sensa.expression_binding_confirmations (
  expression_binding_confirmation_id,
  operation_id,
  workspace_id,
  learner_user_id,
  sense_proposal_version_id,
  personal_expression_anchor_revision_id,
  sense_version_id,
  expression_version_id,
  binding_version_id,
  confirmed_at
) VALUES (
  '10000000-0000-4000-8000-000000000033',
  '10000000-0000-4000-8000-000000000034',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000030',
  '10000000-0000-4000-8000-000000000025',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000010',
  now()
);
INSERT INTO sensa.personal_meaning_alignments (
  personal_meaning_alignment_id,
  workspace_id,
  learner_user_id,
  personal_meaning_id,
  personal_meaning_revision_id,
  meaning_focus_id,
  meaning_focus_revision_id,
  basis_kind,
  sense_id,
  sense_version_id,
  sense_proposal_confirmation_id
) VALUES (
  '10000000-0000-4000-8000-000000000035',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000014',
  '10000000-0000-4000-8000-000000000015',
  '10000000-0000-4000-8000-000000000017',
  'sense_construction',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000031'
);

-- A clear Context does not manufacture a Meaning Focus. Construction,
-- Proposal, confirmation and Alignment all preserve that absence explicitly.
INSERT INTO sensa.sense_constructions (
  sense_construction_id,
  workspace_id,
  learner_user_id,
  personal_meaning_id,
  personal_meaning_revision_id,
  meaning_focus_id,
  meaning_focus_revision_id,
  familiar_language_tag,
  target_language_tag,
  semantic_policy_version,
  created_by_operation_id
) VALUES (
  '10000000-0000-4000-8000-000000000052',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000014',
  NULL,
  NULL,
  'zh-Hans',
  'en',
  'sensa-semantic-policy-v3',
  '10000000-0000-4000-8000-000000000053'
);
INSERT INTO sensa.sense_proposals (
  sense_proposal_id,
  sense_construction_id,
  workspace_id,
  learner_user_id
) VALUES (
  '10000000-0000-4000-8000-000000000054',
  '10000000-0000-4000-8000-000000000052',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner'
);
INSERT INTO sensa.sense_proposal_versions (
  sense_proposal_version_id,
  sense_proposal_id,
  workspace_id,
  learner_user_id,
  version,
  meaning_focus_revision_id,
  semantic_spec,
  expression_candidates,
  semantic_policy_version,
  generator_provenance
) VALUES (
  '10000000-0000-4000-8000-000000000055',
  '10000000-0000-4000-8000-000000000054',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  1,
  NULL,
  '{"schemaVersion":"sensa-sense-semantic-spec-v1"}'::jsonb,
  '[{"surfaceForm":"borrow","languageTag":"en","expressionType":"word"}]'::jsonb,
  'sensa-semantic-policy-v3',
  '{"provider":"smoke","model":"smoke","promptVersion":"v1"}'::jsonb
);
INSERT INTO sensa.sense_proposal_confirmations (
  sense_proposal_confirmation_id,
  operation_id,
  workspace_id,
  learner_user_id,
  sense_proposal_version_id,
  meaning_focus_revision_id,
  resolution,
  sense_id,
  sense_version_id,
  confirmed_at
) VALUES (
  '10000000-0000-4000-8000-000000000056',
  '10000000-0000-4000-8000-000000000057',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000055',
  NULL,
  'reuse_existing',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  now()
);
INSERT INTO sensa.personal_meaning_alignments (
  personal_meaning_alignment_id,
  workspace_id,
  learner_user_id,
  personal_meaning_id,
  personal_meaning_revision_id,
  meaning_focus_id,
  meaning_focus_revision_id,
  basis_kind,
  sense_id,
  sense_version_id,
  sense_proposal_confirmation_id
) VALUES (
  '10000000-0000-4000-8000-000000000058',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000014',
  NULL,
  NULL,
  'sense_construction',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000056'
);

-- A complete Intake can enter through the same Personal Meaning authority
-- without inventing a Construction, Proposal or Focus. The entry surface is
-- provenance inside the acceptance; it is not an Alignment type.
INSERT INTO sensa.semantic_acceptances (
  semantic_acceptance_id,
  operation_id,
  workspace_id,
  learner_user_id,
  authority,
  personal_semantic_anchor_revision_id,
  personal_expression_anchor_revision_id,
  expression_occurrence,
  resolution,
  sense_id,
  sense_version_id,
  resolution_provenance,
  accepted_at
) VALUES (
  '10000000-0000-4000-8000-000000000080',
  '10000000-0000-4000-8000-000000000081',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '{"mode":"learner_direct"}'::jsonb,
  '10000000-0000-4000-8000-000000000022',
  '10000000-0000-4000-8000-000000000025',
  '{"kind":"text_span","start":29,"end":35}'::jsonb,
  'reuse_existing',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '{"resolverKind":"external_tool","provider":"browser-extension","sourceReferenceIds":["capture-1"]}'::jsonb,
  now()
);

INSERT INTO sensa.personal_meaning_alignments (
  personal_meaning_alignment_id,
  workspace_id,
  learner_user_id,
  personal_meaning_id,
  personal_meaning_revision_id,
  meaning_focus_id,
  meaning_focus_revision_id,
  basis_kind,
  sense_id,
  sense_version_id,
  semantic_acceptance_id
) VALUES (
  '10000000-0000-4000-8000-000000000082',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000014',
  NULL,
  NULL,
  'contextual_resolution',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000080'
);

INSERT INTO sensa.personal_meaning_alignment_events (
  personal_meaning_alignment_event_id,
  personal_meaning_alignment_id,
  workspace_id,
  learner_user_id,
  ordinal,
  event_type,
  operation_id,
  occurred_at
) VALUES (
  '10000000-0000-4000-8000-000000000083',
  '10000000-0000-4000-8000-000000000082',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  1,
  'confirmed',
  '10000000-0000-4000-8000-000000000084',
  now()
);
INSERT INTO sensa.personal_meaning_alignment_events (
  personal_meaning_alignment_event_id,
  personal_meaning_alignment_id,
  workspace_id,
  learner_user_id,
  ordinal,
  event_type,
  operation_id,
  occurred_at
) VALUES (
  '10000000-0000-4000-8000-000000000036',
  '10000000-0000-4000-8000-000000000035',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  1,
  'confirmed',
  '10000000-0000-4000-8000-000000000037',
  now()
);

DO $$
BEGIN
  BEGIN
    INSERT INTO sensa.personal_meaning_alignment_events (
      personal_meaning_alignment_event_id,
      personal_meaning_alignment_id,
      workspace_id,
      learner_user_id,
      ordinal,
      event_type,
      operation_id,
      occurred_at
    ) VALUES (
      '10000000-0000-4000-8000-000000000046',
      '10000000-0000-4000-8000-000000000035',
      '10000000-0000-4000-8000-000000000001',
      'psw-smoke-learner',
      2,
      'restored',
      '10000000-0000-4000-8000-000000000047',
      now()
    );
    RAISE EXCEPTION 'Alignment transition guard accepted an invalid restore';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO sensa.personal_meaning_alignment_events (
  personal_meaning_alignment_event_id,
  personal_meaning_alignment_id,
  workspace_id,
  learner_user_id,
  ordinal,
  event_type,
  operation_id,
  occurred_at
) VALUES
  (
    '10000000-0000-4000-8000-000000000048',
    '10000000-0000-4000-8000-000000000035',
    '10000000-0000-4000-8000-000000000001',
    'psw-smoke-learner',
    2,
    'withdrawn',
    '10000000-0000-4000-8000-000000000049',
    now()
  );

INSERT INTO sensa.personal_meaning_alignment_events (
  personal_meaning_alignment_event_id,
  personal_meaning_alignment_id,
  workspace_id,
  learner_user_id,
  ordinal,
  event_type,
  operation_id,
  occurred_at
) VALUES (
  '10000000-0000-4000-8000-000000000050',
  '10000000-0000-4000-8000-000000000035',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  3,
  'restored',
  '10000000-0000-4000-8000-000000000051',
  now()
);

INSERT INTO sensa.retention_targets (
  retention_target_id,
  workspace_id,
  learner_user_id,
  sense_id,
  sense_expression_binding_id
) VALUES
  (
    '10000000-0000-4000-8000-000000000038',
    '10000000-0000-4000-8000-000000000001',
    'psw-smoke-learner',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000008'
  ),
  (
    '10000000-0000-4000-8000-000000000039',
    '10000000-0000-4000-8000-000000000001',
    'psw-smoke-learner',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000009'
  );

INSERT INTO sensa.learning_targets (
  learning_target_id,
  workspace_id,
  learner_user_id,
  retention_target_id,
  sense_id,
  sense_version_id,
  sense_expression_binding_id,
  binding_version_id,
  familiar_language_tag,
  target_language_tag,
  learner_locale,
  curriculum_provenance,
  created_by_operation_id
) VALUES (
  '10000000-0000-4000-8000-000000000040',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000038',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000008',
  '10000000-0000-4000-8000-000000000010',
  'zh-Hans',
  'en',
  'zh-Hans',
  '{"source":"personal_alignment"}'::jsonb,
  '10000000-0000-4000-8000-000000000041'
);
INSERT INTO sensa.learning_target_personal_sources (
  learning_target_personal_source_id,
  learning_target_id,
  personal_meaning_alignment_id,
  workspace_id,
  learner_user_id
) VALUES (
  '10000000-0000-4000-8000-000000000042',
  '10000000-0000-4000-8000-000000000040',
  '10000000-0000-4000-8000-000000000035',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner'
);
INSERT INTO sensa.personal_anchor_use_grants (
  personal_anchor_use_grant_id,
  workspace_id,
  learner_user_id,
  personal_semantic_anchor_revision_id,
  personal_meaning_alignment_id,
  sense_id,
  learning_target_id,
  purpose,
  granted_by_operation_id,
  granted_at
) VALUES (
  '10000000-0000-4000-8000-000000000043',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000022',
  '10000000-0000-4000-8000-000000000035',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000040',
  'content_generation',
  '10000000-0000-4000-8000-000000000044',
  now()
);
INSERT INTO sensa.learning_materializations (
  learning_materialization_id,
  workspace_id,
  learner_user_id,
  learning_target_id,
  protocol_purpose,
  provisioning_path,
  content_schema_version,
  content_payload,
  content_digest,
  validation_status,
  validator_version,
  provenance
) VALUES (
  '10000000-0000-4000-8000-000000000045',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner',
  '10000000-0000-4000-8000-000000000040',
  'initial_learning',
  'on_demand',
  'sensa-lightweight-materialization-v1',
  '{"items":[]}'::jsonb,
  repeat('b', 64),
  'validated',
  'sensa-materialization-validator-v1',
  '{"source":"on_demand"}'::jsonb
);
INSERT INTO sensa.learning_materialization_anchor_grants (
  learning_materialization_id,
  personal_anchor_use_grant_id,
  workspace_id,
  learner_user_id
) VALUES (
  '10000000-0000-4000-8000-000000000045',
  '10000000-0000-4000-8000-000000000043',
  '10000000-0000-4000-8000-000000000001',
  'psw-smoke-learner'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM sensa.personal_meanings WHERE learner_user_id = 'psw-smoke-learner') <> 1 THEN
    RAISE EXCEPTION 'Personal Semantic World membership projection is incorrect';
  END IF;
  IF (SELECT count(*) FROM sensa.retention_targets WHERE learner_user_id = 'psw-smoke-learner') <> 2 THEN
    RAISE EXCEPTION 'Different target Bindings did not create distinct Retention Targets';
  END IF;
  IF (SELECT count(*) FROM sensa.learning_materializations WHERE validation_status = 'validated') <> 1 THEN
    RAISE EXCEPTION 'Validated Learning Materialization was not created';
  END IF;
  IF (
    SELECT count(*)
    FROM sensa.personal_meaning_alignments
    WHERE basis_kind = 'contextual_resolution'
      AND semantic_acceptance_id IS NOT NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'Complete Intake did not create a contextual-resolution Alignment';
  END IF;
END;
$$;

ROLLBACK;
