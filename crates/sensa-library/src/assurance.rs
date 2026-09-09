//! Structured runtime content and high-assurance application adapter.
use super::*;
use base64::Engine;
use rusqlite::Transaction;
use serde_json::Value;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Artifact {
    format: String,
    release: Value,
    media: Vec<Media>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Media {
    media_key: String,
    bytes_base64: String,
}

fn field<'a>(v: &'a Value, k: &str) -> Result<&'a str> {
    v[k].as_str().ok_or(Error::Rule("invalid_runtime_release"))
}
/// Release import is atomic with the library operation receipt; it never enrolls.
pub(super) fn import(tx: &Transaction<'_>, encoded: &str) -> Result<()> {
    if encoded.len() > 20_000_000 {
        return Err(Error::Rule("pack_too_large"));
    }
    let input: Value = serde_json::from_str(encoded)?;
    let (input, media) = if input.get("format").is_some() {
        let artifact: Artifact = serde_json::from_value(input)?;
        if artifact.format != "sensa-runtime-artifact-v1" {
            return Err(Error::Rule("unsupported_pack"));
        }
        (artifact.release, artifact.media)
    } else {
        (input, vec![])
    };
    let release = sensa_core::runtime_release::admit(&input)
        .map_err(|_| Error::Rule("invalid_runtime_release"))?;
    if release["release"]["targetLanguage"] != "en"
        || release["release"]["learnerLocale"] != "zh-CN"
    {
        return Err(Error::Rule("unsupported_pack"));
    }
    let rid = field(&release["release"], "releaseKey")?;
    let version = release["release"]["version"]
        .as_i64()
        .ok_or(Error::Rule("invalid_runtime_release"))?;
    let content = serde_json::to_string(&release)?;
    let digest = format!("{:x}", Sha256::digest(content.as_bytes()));
    let old: Option<String> = tx
        .query_row(
            "SELECT digest FROM runtime_releases WHERE id=?1 AND version=?2",
            params![rid, version],
            |r| r.get(0),
        )
        .optional()?;
    if old.as_ref().is_some_and(|d| *d != digest) {
        return Err(Error::Rule("pack_version_conflict"));
    }
    tx.execute(
        "INSERT INTO runtime_releases VALUES(?1,?2,?3,?4) ON CONFLICT(id,version) DO NOTHING",
        params![rid, version, digest, content],
    )?;
    let mut seen = std::collections::BTreeSet::new();
    for asset in media {
        if !seen.insert(asset.media_key.clone()) {
            return Err(Error::Rule("invalid_runtime_media"));
        }
        let declared = release["media"]
            .as_array()
            .and_then(|ms| ms.iter().find(|m| m["mediaKey"] == asset.media_key))
            .ok_or(Error::Rule("invalid_runtime_media"))?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&asset.bytes_base64)
            .map_err(|_| Error::Rule("invalid_runtime_media"))?;
        let digest = format!("sha256:{:x}", Sha256::digest(&bytes));
        if bytes.is_empty() || bytes.len() > 10_000_000 || declared["sha256"] != digest {
            return Err(Error::Rule("invalid_runtime_media"));
        }
        tx.execute(
            "INSERT INTO runtime_media VALUES(?1,?2,?3) ON CONFLICT(digest) DO NOTHING",
            params![digest, field(declared, "mimeType")?, bytes],
        )?;
    }
    for p in release["packages"]
        .as_array()
        .ok_or(Error::Rule("invalid_runtime_release"))?
    {
        let ident = &p["identity"];
        let key = field(ident, "packageKey")?;
        let pv = ident["packageVersion"]
            .as_i64()
            .ok_or(Error::Rule("invalid_runtime_release"))?;
        let teaching = sensa_core::assurance_material::teaching(&release, key)
            .map_err(|_| Error::Rule("invalid_runtime_release"))?;
        sensa_core::assurance_material::inventory(p)
            .map_err(|_| Error::Rule("invalid_runtime_release"))?;
        let id = format!("runtime:{key}@{pv}");
        // The old runtime artifact pins Sense + Lexeme versions, not an independently
        // published Binding ID. Namespace that exact legacy binding; never alias UUIDs.
        let sense = format!(
            "runtime:{}@{}",
            field(ident, "senseKey")?,
            ident["senseVersion"]
        );
        let binding = format!(
            "runtime:{}@{}:{}@{}",
            field(ident, "senseKey")?,
            ident["senseVersion"],
            field(ident, "lexemeKey")?,
            ident["lexemeVersion"]
        );
        let fallback = p["experience"]["renders"]
            .as_array()
            .and_then(|rs| rs.iter().find(|r| r["kind"] == "text"))
            .map(|r| field(r, "sceneL1"))
            .transpose()?
            .unwrap_or(field(&p["experience"]["recap"], "bodyL1")?);
        let m = Material {
            pronunciation: None,
            id: id.clone(),
            sense_version_id: sense,
            binding_version_id: binding,
            scene: fallback.into(),
            sense: field(&teaching, "guideLabelL1")?.into(),
            expression: field(&teaching, "lemma")?.into(),
            source: format!("{rid}@{version}/{key}@{pv}"),
        };
        let material = serde_json::to_string(&m)?;
        let md = format!("{:x}", Sha256::digest(material.as_bytes()));
        let prior: Option<String> = tx
            .query_row("SELECT digest FROM materials WHERE id=?1", [&id], |r| {
                r.get(0)
            })
            .optional()?;
        if prior.as_ref().is_some_and(|d| *d != md) {
            return Err(Error::Rule("material_version_conflict"));
        }
        let existing: Option<String> = tx
            .query_row(
                "SELECT materialization_digest FROM assurance_materials WHERE material_id=?1",
                [&id],
                |r| r.get(0),
            )
            .optional()?;
        // Pin the complete dependency closure, including relations and lexical forms.
        let frozen = format!(
            "{:x}",
            Sha256::digest(format!("{digest}:{key}@{pv}").as_bytes())
        );
        if existing.as_ref().is_some_and(|d| *d != frozen) {
            return Err(Error::Rule("material_version_conflict"));
        }
        let collision:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM materials WHERE id<>?1 AND json_extract(content,'$.senseVersionId')=?2 AND json_extract(content,'$.bindingVersionId')=?3)",params![id,m.sense_version_id,m.binding_version_id],|r|r.get(0))?;
        if collision {
            return Err(Error::Rule("target_material_conflict"));
        }
        tx.execute(
            "INSERT INTO materials VALUES(?1,?2,?3) ON CONFLICT(id) DO NOTHING",
            params![id, md, material],
        )?;
        tx.execute("INSERT INTO assurance_materials VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(material_id) DO NOTHING",params![id,rid,version,key,pv,frozen])?;
        tx.execute(
            "INSERT INTO material_policy_sources VALUES(?1,?2) ON CONFLICT DO NOTHING",
            params![id, format!("runtime:{rid}@{version}")],
        )?;
        tx.execute(
            "UPDATE library SET selected_material_id=COALESCE(selected_material_id,?1)",
            [id],
        )?;
    }
    policy::refresh(tx)?;
    Ok(())
}
/// Loading validates the fixed dependency digest before any projection or grading.
pub(super) fn load(db: &Connection, material: &str) -> Result<(Value, String, String)> {
    let (content,digest,key,pv,frozen):(String,String,String,i64,String)=db.query_row("SELECT r.content,r.digest,m.package_key,m.package_version,m.materialization_digest FROM assurance_materials m JOIN runtime_releases r ON r.id=m.release_id AND r.version=m.release_version WHERE m.material_id=?1",[material],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?;
    if format!("{:x}", Sha256::digest(content.as_bytes())) != digest
        || format!(
            "{:x}",
            Sha256::digest(format!("{digest}:{key}@{pv}").as_bytes())
        ) != frozen
    {
        return Err(Error::Rule("material_mismatch"));
    }
    Ok((serde_json::from_str(&content)?, key, frozen))
}
pub(super) fn ready(db: &Connection, material: &str) -> Result<bool> {
    let exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM assurance_materials WHERE material_id=?1)",
        [material],
        |r| r.get(0),
    )?;
    if !exists {
        return Ok(false);
    }
    let (release, _, _) = load(db, material)?;
    for m in release["media"]
        .as_array()
        .ok_or(Error::Rule("material_mismatch"))?
    {
        let digest = field(m, "sha256")?;
        let row: Option<(String, Vec<u8>)> = db
            .query_row(
                "SELECT mime_type,bytes FROM runtime_media WHERE digest=?1",
                [digest],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((mime, bytes)) = row else {
            return Ok(false);
        };
        if mime != field(m, "mimeType")? || format!("sha256:{:x}", Sha256::digest(bytes)) != digest
        {
            return Err(Error::Rule("material_mismatch"));
        }
    }
    Ok(true)
}
