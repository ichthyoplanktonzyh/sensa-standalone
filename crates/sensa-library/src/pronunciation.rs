//! Optional immutable pronunciation references and a replaceable, library-local byte cache.
//! Cache writes are not learning facts: no operation receipt, revision, outcome or schedule changes.
use super::*;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reference {
    pub digest: String,
    pub source_text_digest: String,
    pub mime_type: String,
    pub byte_size: usize,
}
impl Reference {
    pub fn validate(&self, expression: &str) -> Result<()> {
        if self.digest.len() != 64
            || !self
                .digest
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            || self.source_text_digest != format!("{:x}", Sha256::digest(expression.as_bytes()))
            || self.mime_type != "audio/mpeg"
            || self.byte_size == 0
            || self.byte_size > 2 * 1024 * 1024
        {
            return Err(Error::Rule("invalid_pronunciation"));
        }
        Ok(())
    }
    fn verify(&self, bytes: &[u8]) -> Result<()> {
        if bytes.len() != self.byte_size || format!("{:x}", Sha256::digest(bytes)) != self.digest {
            return Err(Error::Rule("pronunciation_digest_mismatch"));
        }
        Ok(())
    }
}
fn reference(db: &Connection, material_id: &str) -> Result<Reference> {
    let content: String = db
        .query_row(
            "SELECT content FROM materials WHERE id=?1",
            [material_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(Error::Rule("material_unavailable"))?;
    let material: Material = serde_json::from_str(&content)?;
    let reference = material
        .pronunciation
        .ok_or(Error::Rule("pronunciation_unavailable"))?;
    reference.validate(&material.expression)?;
    Ok(reference)
}
/// The material already owns a verified fixed reference. Downloads cannot change it.
pub fn cache(path: &Path, material_id: &str, bytes: &[u8]) -> Result<()> {
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(Error::Rule("invalid_pronunciation"));
    }
    let mut db = connection(path)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let reference = reference(&tx, material_id)?;
    reference.verify(bytes)?;
    tx.execute("INSERT INTO runtime_media VALUES(?1,?2,?3) ON CONFLICT(digest) DO UPDATE SET mime_type=excluded.mime_type,bytes=excluded.bytes",params![format!("sha256:{}",reference.digest),reference.mime_type,bytes])?;
    tx.commit()?;
    Ok(())
}
/// Used to prepare offline availability. Every read checks bytes, including after cold start.
pub fn cached(path: &Path, material_id: &str) -> Result<Vec<u8>> {
    let db = connection(path)?;
    let reference = reference(&db, material_id)?;
    let bytes: Vec<u8> = db
        .query_row(
            "SELECT bytes FROM runtime_media WHERE digest=?1",
            [format!("sha256:{}", reference.digest)],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(Error::Rule("pronunciation_not_cached"))?;
    reference.verify(&bytes)?;
    Ok(bytes)
}
