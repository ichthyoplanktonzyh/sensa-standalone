//! Personal learning admission precedes material readiness. No private Anchor is sent by default.
use super::*;
use semantic::hash;
use sensa_core::planning::PolicyRef;
use serde_json::{Value, json};
use unicode_normalization::UnicodeNormalization;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Add {
        meaning_id: String,
        expected_revision: u32,
        policy: PolicyRef,
    },
    SetPolicy {
        task_id: String,
        expected_revision: u32,
        policy: PolicyRef,
    },
    Begin {
        task_id: String,
        expected_revision: u32,
        #[serde(default)]
        service_origin: Option<String>,
    },
    Cancel {
        task_id: String,
        expected_revision: u32,
    },
    Finish {
        task_id: String,
        result: Value,
    },
    Fail {
        task_id: String,
        attempt_id: String,
        reason: String,
    },
}
pub(super) fn read(db: &Connection, id: &str) -> Result<Value> {
    let s: String = db
        .query_row(
            "SELECT content FROM personal_learning_tasks WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(Error::Rule("preparation_unavailable"))?;
    Ok(serde_json::from_str(&s)?)
}
fn write(db: &Connection, v: &mut Value) -> Result<()> {
    v["revision"] = json!(v["revision"].as_u64().unwrap_or(0) + 1);
    db.execute(
        "UPDATE personal_learning_tasks SET content=?2 WHERE id=?1",
        params![v["id"].as_str(), v.to_string()],
    )?;
    Ok(())
}
fn revision(v: &Value, expected: u32) -> Result<()> {
    if v["revision"] != expected {
        return Err(Error::Rule("revision_conflict"));
    }
    Ok(())
}
fn supported(p: &PolicyRef) -> bool {
    p.profile_id == "lightweight" && p.profile_version == "v1"
}
fn status(v: &mut Value, p: &PolicyRef) {
    v["status"] = json!(if supported(p) { "pending" } else { "blocked" });
    v["reason"] = if supported(p) {
        Value::Null
    } else {
        json!("unsupported_content_policy")
    };
}
fn text(v: &Value, max: usize) -> Result<&str> {
    v.as_str()
        .filter(|s| !s.trim().is_empty() && s.encode_utf16().count() <= max)
        .ok_or(Error::Rule("invalid_prepared_material"))
}
fn array(v: &Value) -> Result<&Vec<Value>> {
    v.as_array().ok_or(Error::Rule("invalid_prepared_material"))
}
fn require(test: bool) -> Result<()> {
    if test {
        Ok(())
    } else {
        Err(Error::Rule("invalid_prepared_material"))
    }
}
/// Deterministic second boundary after the service's independent reviewer and shared assembler.
pub fn validate_result(input: &Value, result: &Value) -> Result<(String, String, String)> {
    require(
        result["version"] == "sensa-native-provisioning-v1"
            && result["id"] == input["id"]
            && result["inputDigest"] == input["inputDigest"]
            && result["status"] == "ready"
            && result["reason"].is_null(),
    )?;
    let proof = &result["proof"];
    let request = &proof["request"];
    let bundle = &proof["bundle"];
    let content = &proof["content"];
    let demand: Value = serde_json::from_str(include_str!("lightweight-demand-v1.json"))?;
    require(
        request["demand"] == demand
            && request["contentProvisioningTaskId"] == input["taskId"]
            && request["contentAgentAttemptId"] == input["id"]
            && request["learnerUserId"] == input["learnerId"]
            && request["learningTargetId"] == input["taskId"]
            && request["resolvedLearningPlanRevisionId"] == input["planRevision"]
            && request["profileId"] == "lightweight"
            && request["profileVersion"] == "v1"
            && request["protocolId"] == "consumer-initial"
            && request["protocolVersion"] == "v1"
            && request["protocolPurpose"] == "initial_learning"
            && request["provisioningPath"] == "on_demand"
            && request["senseId"] == input["target"]["senseId"]
            && request["senseVersionId"] == input["target"]["senseVersionId"]
            && request["senseExpressionBindingId"] == input["target"]["bindingId"],
    )?;
    require(
        request["contractVersion"] == "sensa-learning-content-v3"
            && request["approvedTools"] == json!([])
            && request["generatorPolicyId"] == "consumer-content"
            && request["generatorPolicyVersion"] == "v3"
            && request["attemptBudget"]
                == json!({"maxModelTurns":1,"maxToolCalls":0,"timeoutMs":35000}),
    )?;
    let artifacts = array(&request["contextArtifacts"])?;
    let audio = result["material"].get("pronunciation");
    let audio_count = usize::from(audio.is_some());
    require(artifacts.len() == 3 + audio_count)?;
    let proposal = &input["target"];
    let expression = text(&proposal["expression"]["surface"], 2000)?;
    let mut ids = Vec::new();
    for (kind, source, expected) in [
        (
            "expression_snapshot",
            "target_expression",
            json!({"surface":expression,"languageTag":"en","expressionKind":if proposal["expression"]["type"]=="word"{"word"}else{"phrase"}}),
        ),
        (
            "sense_snapshot",
            "confirmed_sense",
            json!({"meaning":proposal["semanticSpec"]["coreMeaningFocus"],"familiarLanguageTag":"zh-CN"}),
        ),
        (
            "origin_experience",
            if input["anchor"].is_object() {
                "personal_anchor"
            } else {
                "other_authoritative_source"
            },
            json!({"scene":if input["anchor"].is_object() {&input["anchor"]["sentence"]} else {&proposal["semanticSpec"]["prototypeScenes"][0]["summary"]},"senseFocus":proposal["semanticSpec"]["coreMeaningFocus"],"featureLabels":[]}),
        ),
    ] {
        let matches: Vec<_> = artifacts
            .iter()
            .filter(|a| a["contextKind"] == kind)
            .collect();
        require(matches.len() == 1)?;
        let a = matches[0];
        require(
            a["source"] == source
                && a["payload"] == expected
                && a["personalAnchorUseGrantId"]
                    == if kind == "origin_experience" {
                        input["anchor"]["grantId"].clone()
                    } else {
                        Value::Null
                    }
                && a["contentDigest"] == hash(&expected)?,
        )?;
        require(
            a["sourceVersion"]
                == if kind == "origin_experience" && input["anchor"].is_object() {
                    input["anchor"]["contextVersion"].clone()
                } else {
                    input["target"][if kind == "expression_snapshot" {
                        "bindingVersionId"
                    } else {
                        "senseVersionId"
                    }]
                    .clone()
                }
                && a["contentSchemaId"] == format!("lightweight.{}", kind.replace('_', "-"))
                && a["contentSchemaVersion"] == "v1"
                && a["producerToolCallId"].is_null()
                && a["mediaReference"].is_null(),
        )?;
        ids.push(a["artifactId"].clone());
    }
    if let Some(audio) = audio {
        let reference: pronunciation::Reference = serde_json::from_value(audio.clone())?;
        reference.validate(expression)?;
        let facts: Vec<_> = artifacts
            .iter()
            .filter(|a| a["contextKind"] == "reference_fact")
            .collect();
        require(facts.len() == 1)?;
        let a = facts[0];
        let expected = json!({"factKind":"pronunciation","audioUrl":format!("sensa-media:{}",reference.digest),"phoneticNotation":null,"accentLabel":null});
        require(
            a["source"] == "pronunciation_lexicon"
                && a["sourceVersion"] == reference.digest
                && a["payload"] == expected
                && a["contentDigest"] == hash(&expected)?
                && a["contentSchemaId"] == "lightweight.reference-fact"
                && a["contentSchemaVersion"] == "v1"
                && a["personalAnchorUseGrantId"].is_null()
                && a["producerToolCallId"].is_null()
                && a["mediaReference"].is_null(),
        )?;
        ids.push(a["artifactId"].clone());
    }
    require(
        bundle["contentProvisioningTaskId"] == input["taskId"]
            && bundle["contentAgentAttemptId"] == input["id"]
            && bundle["contentGenerationRequestId"] == request["contentGenerationRequestId"]
            && bundle["inputSnapshotDigest"] == hash(request)?
            && bundle["supportingContextArtifacts"] == json!([])
            && bundle["toolCalls"] == json!([])
            && proof["adapter"]
                == if audio.is_some() {
                    "native-lightweight-v2"
                } else {
                    "native-lightweight-v1"
                }
            && proof["contentDigest"] == hash(content)?
            && proof["materialDigest"] == hash(&result["material"])?,
    )?;
    require(
        bundle["contractVersion"] == "sensa-learning-content-v3"
            && bundle["usage"]["modelTurns"] == 1
            && bundle["usage"]["toolCalls"] == 0,
    )?;
    let omissions = array(&bundle["omissions"])?;
    let optional: Vec<_> = array(&demand["materialRoles"])?
        .iter()
        .filter(|v| {
            v["required"] == false && !(audio.is_some() && v["materialRoleKey"] == "pronunciation")
        })
        .collect();
    require(omissions.len() == optional.len())?;
    for role in optional {
        require(
            omissions
                .iter()
                .filter(|v| {
                    v["materialRoleKey"] == role["materialRoleKey"]
                        && v["reasonCode"] == "optional_resource_unavailable"
                })
                .count()
                == 1,
        )?;
    }
    let review = &proof["validation"]["review"];
    require(review["accepted"] == true && proof["validation"]["issues"] == json!([]))?;
    text(&review["provider"], 200)?;
    text(&review["model"], 200)?;
    let candidates = array(&bundle["candidates"])?;
    let resources = array(&content["resources"])?;
    let validations = array(&proof["validation"]["validations"])?;
    require(
        candidates.len() == 3 + audio_count
            && resources.len() == 3 + audio_count
            && validations.len() == 3 + audio_count
            && content["contentDemandKey"] == "lightweight-initial-content"
            && content["definitionVersion"] == "v1"
            && content["contentGenerationRequestId"] == request["contentGenerationRequestId"],
    )?;
    let mut roles = vec![
        "experience_recall_cue",
        "target_expression",
        "sense_confirmation",
    ];
    if audio.is_some() {
        roles.push("pronunciation");
    }
    for role in roles {
        let matched: Vec<_> = candidates
            .iter()
            .filter(|v| v["materialRoleKey"] == role)
            .collect();
        require(matched.len() == 1)?;
        let candidate = matched[0];
        let definition = array(&demand["materialRoles"])?
            .iter()
            .find(|v| v["materialRoleKey"] == role)
            .unwrap();
        require(
            candidate["ordinal"] == 0
                && candidate["contentGenerationRequestId"] == request["contentGenerationRequestId"]
                && candidate["contentSchemaId"] == definition["contentSchemaId"]
                && candidate["contentSchemaVersion"] == "v1"
                && candidate["producerPolicyId"] == definition["provisioningPolicyId"]
                && candidate["producerPolicyVersion"] == definition["provisioningPolicyVersion"]
                && candidate["contentDigest"] == hash(&candidate["contentPayload"])?,
        )?;
        if role == "pronunciation" {
            let expression_candidate = candidates
                .iter()
                .find(|v| v["materialRoleKey"] == "target_expression")
                .ok_or(Error::Rule("invalid_prepared_material"))?;
            require(
                candidate["sourceArtifactIds"] == json!([ids[3]])
                    && candidate["sourceMaterialCandidateIds"]
                        == json!([expression_candidate["materialCandidateId"]])
                    && candidate["contentPayload"]
                        == json!({"audioUrl":format!("sensa-media:{}",audio.unwrap()["digest"].as_str().unwrap_or("")),"phoneticNotation":null,"accentLabel":null}),
            )?;
        } else {
            require(
                candidate["sourceArtifactIds"] == json!(ids)
                    && candidate["sourceMaterialCandidateIds"] == json!([]),
            )?;
        }
        if role == "experience_recall_cue" {
            require(
                candidate["productionMethod"] == "model_generation"
                    && candidate["producerProvider"] == bundle["provider"]
                    && candidate["producerModel"] == bundle["model"],
            )?;
        } else {
            require(
                candidate["productionMethod"] == "deterministic_transform"
                    && candidate["producerProvider"]
                        == if role == "pronunciation" {
                            "sensa-static-pronunciation"
                        } else {
                            "sensa-authority"
                        }
                    && candidate["producerModel"].is_null(),
            )?;
        }
        if role == "target_expression" {
            require(candidate["contentPayload"] == json!({"surface":expression}))?;
        }
        if role == "sense_confirmation" {
            require(
                candidate["contentPayload"]
                    == json!({"meaning":proposal["semanticSpec"]["coreMeaningFocus"]}),
            )?;
        }
        if role == "experience_recall_cue" {
            require(
                candidate["contentPayload"]
                    == json!({"scene":result["material"]["scene"],"senseFocus":result["material"]["sense"]}),
            )?;
        }
        let matching: Vec<_> = validations
            .iter()
            .filter(|v| v["materialCandidateId"] == candidate["materialCandidateId"])
            .collect();
        require(matching.len() == 1)?;
        let validation = matching[0];
        require(validation["status"] == "accepted")?;
        let policies = array(&definition["validatorPolicies"])?;
        let checked = array(&validation["validatorResults"])?;
        require(policies.len() == checked.len())?;
        for p in policies {
            require(
                checked
                    .iter()
                    .filter(|v| {
                        v["validatorPolicyId"] == p["validatorPolicyId"]
                            && v["validatorVersion"] == p["validatorVersion"]
                            && v["status"] == "passed"
                            && v["issueCodes"] == json!([])
                    })
                    .count()
                    == 1,
            )?;
        }
        let found: Vec<_> = resources
            .iter()
            .filter(|v| v["materialRoleKey"] == role)
            .collect();
        require(found.len() == 1)?;
        let resource = found[0];
        for field in [
            "materialCandidateId",
            "ordinal",
            "contentPayload",
            "contentDigest",
            "contentSchemaId",
            "contentSchemaVersion",
            "sourceArtifactIds",
            "sourceMaterialCandidateIds",
            "productionMethod",
            "producerProvider",
            "producerModel",
            "producerPolicyId",
            "producerPolicyVersion",
        ] {
            require(resource[field] == candidate[field])?;
        }
        require(resource["resourceKey"] == format!("{role}:0"))?;
    }
    let scene = text(&result["material"]["scene"], 1800)?;
    let sense = text(&result["material"]["sense"], 500)?;
    require(
        scene.encode_utf16().count() >= 10
            && sense.encode_utf16().count() >= 2
            && result["material"]["expression"] == expression
            && scene
                .chars()
                .any(|c| ('\u{3400}'..='\u{9fff}').contains(&c)),
    )?;
    let normalize = |s: &str| {
        s.nfkc()
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };
    require(
        !normalize(scene).contains(&normalize(expression))
            && !normalize(sense).contains(&normalize(expression)),
    )?;
    Ok((scene.into(), sense.into(), expression.into()))
}
pub(super) fn apply(
    db: &Connection,
    action: &Action,
    command: &Command,
    now: DateTime<Utc>,
) -> Result<()> {
    match action {
        Action::Add {
            meaning_id,
            expected_revision,
            policy: p,
        } => {
            let meaning = personal::read_meaning(db, meaning_id, *expected_revision)?;
            if meaning["bindingMetadata"].is_object()
                && (meaning["bindingMetadata"]["relation"] != "realizes"
                    || meaning["bindingMetadata"]["semanticCoverage"] != "exact")
            {
                return Err(Error::Rule("binding_learning_not_supported"));
            }
            if !meaning["materialId"].is_null() {
                return Err(Error::Rule("local_material_already_available"));
            }
            if db.query_row("SELECT daily_new_limit IS NULL FROM library", [], |r| {
                r.get::<_, bool>(0)
            })? {
                return Err(Error::Rule("quantity_required"));
            }
            let target:Option<String>=db.query_row("SELECT id FROM personal_learning_tasks WHERE sense_version_id=?1 AND binding_version_id=?2",params![meaning["senseVersionId"].as_str(),meaning["bindingVersionId"].as_str()],|r|r.get(0)).optional()?;
            let tid = if let Some(t) = target {
                if read(db, &t)?["policy"] != json!(p) {
                    return Err(Error::Rule("learning_target_policy_exists"));
                }
                t
            } else {
                let tid = id();
                policy::append_assignment(db, "target", &tid, Some(p), now.timestamp_millis())?;
                let proposal = semantic::validate_proposal(meaning["proposal"].clone())?;
                let mut task = json!({"id":tid,"revision":1,"policy":p,"planRevision":id(),"target":{"senseId":meaning["senseId"],"senseVersionId":meaning["senseVersionId"],"bindingId":meaning["bindingId"],"bindingVersionId":meaning["bindingVersionId"],"proposal":proposal},"attemptCount":0,"activeAttemptId":null,"materialId":null,"createdAtMs":now.timestamp_millis()});
                status(&mut task, p);
                task["anchor"] = json!(anchor::current(db, meaning_id)?);
                db.execute(
                    "INSERT INTO personal_learning_tasks VALUES(?1,?2,?3,?4)",
                    params![
                        tid,
                        meaning["senseVersionId"].as_str(),
                        meaning["bindingVersionId"].as_str(),
                        task.to_string()
                    ],
                )?;
                tid
            };
            curriculum::supplement(db, &tid)?;
            db.execute("INSERT INTO personal_task_entries VALUES(?1,?2,?3) ON CONFLICT(meaning_id) DO NOTHING",params![meaning_id,tid,command.operation_id])?;
            save_version(db, &read(db, &tid)?)?;
            if let Some(g) = anchor::current(db, meaning_id)?
                && read(db, &tid)?["anchor"] != g
            {
                replace_anchor(db, meaning_id, Some(g), now)?;
            }
            if read(db, &tid)?["status"] == "ready" {
                db.execute("INSERT INTO personal_learning_links VALUES(?1,?2,?3,?4) ON CONFLICT DO NOTHING",params![meaning_id,tid,command.operation_id,now.timestamp_millis()])?;
            }
        }
        Action::SetPolicy {
            task_id,
            expected_revision,
            policy: p,
        } => {
            let mut task = read(db, task_id)?;
            revision(&task, *expected_revision)?;
            if task["status"] == "ready" {
                return Err(Error::Rule("prepared_policy_fixed"));
            }
            if db.query_row(
                "SELECT EXISTS(SELECT 1 FROM policy_commitments WHERE target_id=?1)",
                [task_id],
                |r| r.get::<_, bool>(0),
            )? {
                return Err(Error::Rule("policy_committed"));
            }
            policy::append_assignment(db, "target", task_id, Some(p), now.timestamp_millis())?;
            end_attempt(db, &task, "policy_changed", now)?;
            save_version(db, &task)?;
            task["policy"] = json!(p);
            task["planRevision"] = json!(id());
            task["activeAttemptId"] = Value::Null;
            status(&mut task, p);
            save_version(db, &task)?;
            write(db, &mut task)?;
        }
        Action::Begin {
            task_id,
            expected_revision,
            service_origin,
        } => {
            let mut task = read(db, task_id)?;
            revision(&task, *expected_revision)?;
            if let Some(g) = task.get("anchor").filter(|g| !g.is_null())
                && (!anchor::valid(db, g)? || service_origin.as_deref() != g["recipient"].as_str())
            {
                return Err(Error::Rule("anchor_recipient_mismatch"));
            }
            if task["status"] == "ready" {
                return Err(Error::Rule("preparation_already_ready"));
            }
            if task["status"] == "generating"
                && task["leaseUntilMs"].as_i64().unwrap_or(i64::MAX) > now.timestamp_millis()
            {
                return Err(Error::Rule("preparation_running"));
            }
            let p: PolicyRef = serde_json::from_value(task["policy"].clone())?;
            if !supported(&p) {
                return Err(Error::Rule("unsupported_content_policy"));
            }
            let count = task["attemptCount"].as_u64().unwrap_or(3);
            if count >= 3 {
                return Err(Error::Rule("preparation_budget_exhausted"));
            }
            let recent: u32 = db.query_row(
                "SELECT count(*) FROM personal_content_attempts WHERE started_at_ms>?1",
                [now.timestamp_millis() - 86400000],
                |r| r.get(0),
            )?;
            if recent >= 30 {
                return Err(Error::Rule("daily_preparation_limit"));
            }
            end_attempt(db, &task, "attempt_timed_out", now)?;
            let attempt = id();
            let learner: String =
                db.query_row("SELECT learner_id FROM library", [], |r| r.get(0))?;
            // Explanations may describe the private occurrence. Only reusable semantic facts leave the library.
            let mut target = task["target"].clone();
            target.as_object_mut().unwrap().remove("proposal");
            target["semanticSpec"] = task["target"]["proposal"]["semanticSpec"].clone();
            target["expression"] = task["target"]["proposal"]["expression"].clone();
            let mut request = json!({"version":"sensa-native-provisioning-v1","id":attempt,"taskId":task_id,"learnerId":learner,"planRevision":task["planRevision"],"policy":p,"target":target,"protocol":{"id":"consumer-initial","version":"v1","purpose":"initial_learning"},"demandReference":{"contentDemandKey":"lightweight-initial-content","definitionVersion":"v1"},"requestedAt":now.to_rfc3339()});
            if let Some(g) = task.get("anchor").filter(|g| !g.is_null()) {
                request["anchor"] = json!({"grantId":g["grantId"],"contextVersion":g["contextVersion"],"sentence":g["sentence"],"recipient":g["recipient"]});
            }
            request["inputDigest"] = json!(hash(&request)?);
            db.execute(
                "INSERT INTO personal_content_attempts VALUES(?1,?2,?3,NULL,?4)",
                params![
                    attempt,
                    task_id,
                    request.to_string(),
                    now.timestamp_millis()
                ],
            )?;
            task["activeAttemptId"] = json!(attempt);
            task["attemptCount"] = json!(count + 1);
            task["status"] = json!("generating");
            task["reason"] = Value::Null;
            task["leaseUntilMs"] = json!(now.timestamp_millis() + 90000);
            write(db, &mut task)?;
        }
        Action::Cancel {
            task_id,
            expected_revision,
        } => {
            let mut task = read(db, task_id)?;
            revision(&task, *expected_revision)?;
            if task["status"] == "ready" {
                return Err(Error::Rule("preparation_already_ready"));
            }
            end_attempt(db, &task, "cancelled", now)?;
            task["activeAttemptId"] = Value::Null;
            task["status"] = json!("cancelled");
            task["reason"] = json!("cancelled");
            write(db, &mut task)?;
        }
        Action::Finish { task_id, result } => {
            let mut task = read(db, task_id)?;
            active(&task, text(&result["id"], 100)?, now)?;
            if let Some(g) = task.get("anchor").filter(|g| !g.is_null())
                && !anchor::valid(db, g)?
            {
                return Err(Error::Rule("preparation_superseded"));
            }
            let encoded: String = db.query_row(
                "SELECT request FROM personal_content_attempts WHERE id=?1",
                [result["id"].as_str()],
                |r| r.get(0),
            )?;
            let request: Value = serde_json::from_str(&encoded)?;
            require(
                result["inputDigest"] == request["inputDigest"]
                    && result["version"] == request["version"],
            )?;
            if result["status"] == "blocked" {
                let reason = text(&result["reason"], 100)?;
                if !matches!(
                    reason,
                    "generation_failed"
                        | "validation_unavailable"
                        | "material_invalid"
                        | "material_rejected"
                        | "attempt_timed_out"
                ) {
                    return Err(Error::Rule("invalid_prepared_material"));
                }
                task["status"] = json!("blocked");
                task["reason"] = json!(reason);
            } else {
                let (scene, sense, expression) =
                    if result["proof"]["adapter"] == "native-agent-lightweight-v1" {
                        agent::validated_material(db, &request, result)?
                    } else {
                        validate_result(&request, result)?
                    };
                let material = Material {
                    pronunciation: result["material"]
                        .get("pronunciation")
                        .cloned()
                        .map(serde_json::from_value)
                        .transpose()?,
                    id: id(),
                    sense_version_id: text(&task["target"]["senseVersionId"], 100)?.into(),
                    binding_version_id: text(&task["target"]["bindingVersionId"], 100)?.into(),
                    scene,
                    sense,
                    expression,
                    source: format!("on-demand:{task_id}/{}", text(&result["id"], 100)?),
                };
                let content = serde_json::to_string(&material)?;
                let digest = format!("{:x}", Sha256::digest(content.as_bytes()));
                db.execute(
                    "INSERT INTO materials VALUES(?1,?2,?3)",
                    params![material.id, digest, content],
                )?;
                let old_material: Option<String> = db
                    .query_row(
                        "SELECT material_id FROM targets WHERE id=?1",
                        [task_id],
                        |r| r.get(0),
                    )
                    .optional()?;
                db.execute(
                    "INSERT INTO targets VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET material_id=excluded.material_id",
                    params![
                        task_id,
                        material.id,
                        material.sense_version_id,
                        material.binding_version_id,
                        task["policy"]["profileId"].as_str(),
                        task["policy"]["profileVersion"].as_str()
                    ],
                )?;
                if let Some(old) = old_material {
                    db.execute(
                        "UPDATE library SET selected_material_id=?1 WHERE selected_material_id=?2",
                        params![material.id, old],
                    )?;
                }
                policy::enroll(db, task_id)?;
                db.execute("INSERT INTO personal_learning_links SELECT meaning_id,task_id,?2,?3 FROM personal_task_entries WHERE task_id=?1 ON CONFLICT DO NOTHING",params![task_id,command.operation_id,now.timestamp_millis()])?;
                db.execute(
                    "UPDATE library SET selected_material_id=?1 WHERE selected_material_id IS NULL",
                    [&material.id],
                )?;
                task["status"] = json!("ready");
                task["reason"] = Value::Null;
                task["materialId"] = json!(material.id);
                task["materialDigest"] = json!(digest);
                task["acceptedAttemptId"] = result["id"].clone();
            }
            db.execute(
                "UPDATE personal_content_attempts SET result=?2 WHERE id=?1 AND result IS NULL",
                params![result["id"].as_str(), result.to_string()],
            )?;
            task["activeAttemptId"] = Value::Null;
            write(db, &mut task)?;
            if task["status"] == "ready" {
                policy::refresh_target(db, task_id)?;
            }
        }
        Action::Fail {
            task_id,
            attempt_id,
            reason,
        } => {
            let mut task = read(db, task_id)?;
            active(&task, attempt_id, now)?;
            if !matches!(
                reason.as_str(),
                "network_unavailable"
                    | "lookup_timeout"
                    | "access_required"
                    | "invalid_response"
                    | "provider_unavailable"
            ) {
                return Err(Error::Rule("invalid_preparation_reason"));
            }
            end_attempt(db, &task, reason, now)?;
            task["status"] = json!("blocked");
            task["reason"] = json!(reason);
            task["activeAttemptId"] = Value::Null;
            write(db, &mut task)?;
        }
    }
    Ok(())
}
fn end_attempt(db: &Connection, task: &Value, reason: &str, now: DateTime<Utc>) -> Result<()> {
    if let Some(attempt) = task["activeAttemptId"].as_str() {
        let result = json!({"status":"ended","reason":reason,"endedAtMs":now.timestamp_millis()});
        db.execute(
            "UPDATE personal_content_attempts SET result=?2 WHERE id=?1 AND result IS NULL",
            params![attempt, result.to_string()],
        )?;
    }
    Ok(())
}
pub(super) fn active(task: &Value, attempt: &str, now: DateTime<Utc>) -> Result<()> {
    if task["status"] != "generating" || task["activeAttemptId"] != attempt {
        return Err(Error::Rule("preparation_superseded"));
    }
    if task["leaseUntilMs"].as_i64().unwrap_or(0) <= now.timestamp_millis() {
        return Err(Error::Rule("attempt_timed_out"));
    }
    Ok(())
}
pub(super) fn for_meaning(db: &Connection, meaning: &str) -> Result<Option<Value>> {
    let task: Option<String> = db
        .query_row(
            "SELECT task_id FROM personal_task_entries WHERE meaning_id=?1",
            [meaning],
            |r| r.get(0),
        )
        .optional()?;
    task.map(|t| read(db, &t)).transpose()
}
pub(super) fn project(db: &Connection) -> Result<Vec<Value>> {
    let mut q = db.prepare("SELECT content FROM personal_learning_tasks ORDER BY rowid DESC")?;
    let mut tasks = q
        .query_map([], |r| r.get::<_, String>(0))?
        .map(|r| Ok(serde_json::from_str::<Value>(&r?)?))
        .collect::<Result<Vec<_>>>()?;
    for task in &mut tasks {
        task["policyCommitted"] = json!(db.query_row(
            "SELECT EXISTS(SELECT 1 FROM policy_commitments WHERE target_id=?1)",
            [task["id"].as_str()],
            |r| r.get::<_, bool>(0)
        )?);
        if let Some(active) = task["activeAttemptId"].as_str() {
            let r: String = db.query_row(
                "SELECT request FROM personal_content_attempts WHERE id=?1",
                [active],
                |r| r.get(0),
            )?;
            task["request"] = serde_json::from_str(&r)?;
        }
    }
    if tasks.len() > 500 {
        return Err(Error::Rule("personal_snapshot_limit"));
    }
    Ok(tasks)
}

pub(super) fn save_version(db: &Connection, task: &Value) -> Result<()> {
    let fixed = json!({"id":task["planRevision"],"targetId":task["id"],"target":task["target"],"policy":task["policy"],"anchor":task["anchor"]});
    db.execute(
        "INSERT INTO personal_preparation_versions VALUES(?1,?2,?3) ON CONFLICT(id) DO NOTHING",
        params![
            task["planRevision"].as_str(),
            task["id"].as_str(),
            fixed.to_string()
        ],
    )?;
    Ok(())
}
pub(super) fn replace_anchor(
    db: &Connection,
    meaning: &str,
    grant: Option<Value>,
    now: DateTime<Utc>,
) -> Result<()> {
    let target: Option<String> = db
        .query_row(
            "SELECT task_id FROM personal_task_entries WHERE meaning_id=?1",
            [meaning],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(target) = target {
        let mut task = read(db, &target)?;
        if grant.is_none() && task["anchor"]["meaningId"] != meaning {
            return Ok(());
        }
        save_version(db, &task)?;
        end_attempt(db, &task, "anchor_authorization_changed", now)?;
        task["anchor"] = json!(grant);
        task["planRevision"] = json!(id());
        task["attemptCount"] = json!(0);
        task["activeAttemptId"] = Value::Null;
        let policy: PolicyRef = serde_json::from_value(task["policy"].clone())?;
        status(&mut task, &policy);
        if supported(&policy) {
            task["reason"] = json!("anchor_authorization_changed");
        }
        // Keep the previous immutable material reference for audit, never use it for a new Run.
        save_version(db, &task)?;
        write(db, &mut task)?;
        if db.query_row(
            "SELECT EXISTS(SELECT 1 FROM targets WHERE id=?1)",
            [&target],
            |r| r.get::<_, bool>(0),
        )? {
            policy::refresh_target(db, &target)?;
        }
    }
    Ok(())
}
pub(super) fn material_current(db: &Connection, target: &str) -> Result<bool> {
    if !has_task(db, target)? {
        return Ok(true);
    }
    let s: Option<String> = db
        .query_row(
            "SELECT json_extract(content,'$.status') FROM personal_learning_tasks WHERE id=?1",
            [target],
            |r| r.get(0),
        )
        .optional()?;
    Ok(s.is_none_or(|v| v == "ready"))
}

pub(super) fn has_task(db: &Connection, target: &str) -> Result<bool> {
    let exists:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='personal_learning_tasks')",[],|r|r.get(0))?;
    Ok(exists
        && db.query_row(
            "SELECT EXISTS(SELECT 1 FROM personal_learning_tasks WHERE id=?1)",
            [target],
            |r| r.get::<_, bool>(0),
        )?)
}
