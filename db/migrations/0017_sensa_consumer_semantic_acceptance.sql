CREATE TABLE sensa_consumer.semantic_lookups (
 id UUID NOT NULL,learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id),
 input_digest TEXT NOT NULL,snapshot JSONB,status TEXT NOT NULL CHECK(status IN ('running','ready','unresolved','failed')),
 proposal JSONB,provenance JSONB,reason TEXT,created_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(learner_user_id,id)
);
CREATE TABLE sensa_consumer.personal_meanings (
 id UUID PRIMARY KEY,learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id),
 identity_digest TEXT NOT NULL,snapshot JSONB NOT NULL,proposal JSONB NOT NULL,
 sense_id UUID NOT NULL REFERENCES sensa.senses,sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions,
 binding_id UUID NOT NULL REFERENCES sensa.sense_expression_bindings,binding_version_id UUID NOT NULL REFERENCES sensa.sense_expression_binding_versions,
 context_anchor_id UUID NOT NULL DEFAULT gen_random_uuid(),expression_anchor_id UUID NOT NULL DEFAULT gen_random_uuid(),
 alignment_id UUID NOT NULL UNIQUE,acceptance_id UUID NOT NULL UNIQUE,accepted_at TIMESTAMPTZ NOT NULL,
 lookup_id UUID NOT NULL,operation_id UUID NOT NULL,installation_id UUID NOT NULL REFERENCES sensa_consumer.installations,
 session_id UUID NOT NULL REFERENCES sensa_consumer.sessions,UNIQUE(learner_user_id,identity_digest),
 FOREIGN KEY(learner_user_id,lookup_id) REFERENCES sensa_consumer.semantic_lookups(learner_user_id,id)
);
ALTER TABLE sensa_consumer.intakes ADD COLUMN meaning_id UUID REFERENCES sensa_consumer.personal_meanings;
ALTER TABLE sensa_consumer.changes DROP CONSTRAINT changes_entity_type_check;
ALTER TABLE sensa_consumer.changes ADD CHECK(entity_type IN ('plan','target','run','activity','check_in','intake','personal_meaning'));
GRANT SELECT,INSERT,UPDATE ON sensa_consumer.semantic_lookups TO backend_app;
GRANT SELECT,INSERT ON sensa_consumer.personal_meanings TO backend_app;
GRANT UPDATE(meaning_id,revision) ON sensa_consumer.intakes TO backend_app;
REVOKE ALL ON sensa_consumer.semantic_lookups,sensa_consumer.personal_meanings FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON sensa_consumer.semantic_lookups,sensa_consumer.personal_meanings FROM anon; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON sensa_consumer.semantic_lookups,sensa_consumer.personal_meanings FROM authenticated; END IF;
END $$;
-- Registry identities must become visible together; no INSERT privileges are granted to client roles.
CREATE FUNCTION sensa_consumer.create_accepted_semantic_identity(sid UUID,vid UUID,eid UUID,evid UUID,bid UUID,bvid UUID,spec JSONB,form TEXT,kind TEXT,provenance JSONB)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sensa AS $$ BEGIN
 INSERT INTO sensa.senses(sense_id,sense_key) VALUES(sid,'accepted-'||sid::TEXT);
 INSERT INTO sensa.sense_versions(sense_version_id,sense_id,version_number,version_origin,semantic_policy_version,semantic_spec,semantic_provenance,semantic_review_status)
 VALUES(vid,sid,1,'learner_confirmed','consumer-semantic-v1',spec,provenance,'learner_confirmed');
 INSERT INTO sensa.expressions(expression_id,expression_type,language_tag) VALUES(eid,kind::sensa.expression_type,'en');
 INSERT INTO sensa.expression_versions(expression_version_id,expression_id,version_number,surface_form,normalized_form,semantic_provenance) VALUES(evid,eid,1,form,lower(form),provenance);
 INSERT INTO sensa.sense_expression_bindings(sense_expression_binding_id,sense_id,expression_id,relation) VALUES(bid,sid,eid,'realizes');
 INSERT INTO sensa.sense_expression_binding_versions(binding_version_id,sense_expression_binding_id,version_number,sense_version_id,expression_version_id,semantic_coverage,semantic_provenance,semantic_review_status) VALUES(bvid,bid,1,vid,evid,'exact',provenance,'learner_confirmed');
END $$;
REVOKE ALL ON FUNCTION sensa_consumer.create_accepted_semantic_identity(UUID,UUID,UUID,UUID,UUID,UUID,JSONB,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sensa_consumer.create_accepted_semantic_identity(UUID,UUID,UUID,UUID,UUID,UUID,JSONB,TEXT,TEXT,JSONB) TO backend_app;

CREATE TABLE sensa_consumer.accepted_semantic_identities (
 digest TEXT PRIMARY KEY,sense_id UUID NOT NULL REFERENCES sensa.senses,sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions,
 binding_id UUID NOT NULL REFERENCES sensa.sense_expression_bindings,binding_version_id UUID NOT NULL REFERENCES sensa.sense_expression_binding_versions
);
REVOKE ALL ON sensa_consumer.accepted_semantic_identities FROM PUBLIC;
GRANT SELECT,INSERT ON sensa_consumer.accepted_semantic_identities TO backend_app;
