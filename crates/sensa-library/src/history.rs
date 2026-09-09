//! Read-only completion ledger and calendar queries. No inferred mastery or attempt counts.
use super::*;
use serde_json::{Value, json};
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Query {
    pub start: Option<String>,
    pub end: Option<String>,
    pub kind: Option<String>,
    #[serde(default)]
    pub search: String,
    pub cursor: Option<Cursor>,
    pub offset_minutes: i32,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cursor {
    pub before_ms: i64,
    pub before_id: String,
    pub revision: u32,
}
const ROWS:&str="WITH records AS (
 SELECT 'initial:'||c.id id,r.target_id target_id,r.material_id material_id,'initial_learning' kind,c.occurred_at_ms time_ms,c.kind detail FROM completions c JOIN runs r ON r.id=c.run_id
 UNION ALL
 SELECT 'retention:'||c.id,r.target_id,r.material_id,CASE WHEN c.kind='relearning_completion' THEN 'relearning' ELSE 'retention_review' END,c.occurred_at_ms,c.kind FROM retention_completions c JOIN retention_runs r ON r.id=c.run_id
),filtered AS (
 SELECT r.*,json_extract(m.content,'$.expression') expression,json_extract(m.content,'$.sense') meaning,strftime('%Y-%m-%d',r.time_ms/1000+?1*60,'unixepoch') day FROM records r JOIN materials m ON m.id=r.material_id
 WHERE r.time_ms<=?2 AND (?3 IS NULL OR r.kind=?3) AND (?4='' OR instr(lower(json_extract(m.content,'$.expression')||' '||json_extract(m.content,'$.sense')),lower(?4))>0)
),selected AS (SELECT * FROM filtered WHERE (?5 IS NULL OR day>=?5) AND (?6 IS NULL OR day<=?6)) ";
pub fn query(path: &Path, input: Query) -> Result<Value> {
    if !(-840..=840).contains(&input.offset_minutes)
        || input.search.len() > 500
        || input
            .kind
            .as_deref()
            .is_some_and(|s| !["initial_learning", "retention_review", "relearning"].contains(&s))
    {
        return Err(Error::Rule("invalid_history_filter"));
    }
    let now = Utc::now();
    let today = (now + chrono::Duration::minutes(input.offset_minutes.into()))
        .format("%Y-%m-%d")
        .to_string();
    for date in [&input.start, &input.end].into_iter().flatten() {
        if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err()
            || date.len() != 10
            || date > &today
        {
            return Err(Error::Rule("invalid_history_range"));
        }
    }
    if input
        .start
        .as_ref()
        .zip(input.end.as_ref())
        .is_some_and(|(a, b)| a > b)
    {
        return Err(Error::Rule("invalid_history_range"));
    }
    let db = connection(path)?;
    let tx = db.unchecked_transaction()?;
    let revision: u32 = tx.query_row("SELECT revision FROM library", [], |r| r.get(0))?;
    if input
        .cursor
        .as_ref()
        .is_some_and(|c| c.revision != revision)
    {
        return Err(Error::Rule("history_changed"));
    }
    let args = params![
        input.offset_minutes,
        now.timestamp_millis(),
        input.kind,
        input.search.trim(),
        input.start,
        input.end
    ];
    let mut q =
        tx.prepare(&(ROWS.to_owned() + "SELECT kind,count(*) FROM selected GROUP BY kind"))?;
    let counts = q
        .query_map(args, |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
        .collect::<std::result::Result<std::collections::BTreeMap<_, _>, _>>()?;
    let mut q = tx.prepare(
        &(ROWS.to_owned()
            + "SELECT day,kind,count(*) FROM selected GROUP BY day,kind ORDER BY day DESC,kind"),
    )?;
    let days=q.query_map(args,|r|Ok(json!({"date":r.get::<_,String>(0)?,"kind":r.get::<_,String>(1)?,"count":r.get::<_,i64>(2)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let before = input.cursor.as_ref().map(|c| c.before_ms);
    let before_id = input.cursor.as_ref().map(|c| c.before_id.as_str());
    let mut q=tx.prepare(&(ROWS.to_owned()+"SELECT id,target_id,expression,meaning,kind,time_ms,detail,day FROM selected WHERE (?7 IS NULL OR time_ms<?7 OR (time_ms=?7 AND id<?8)) ORDER BY time_ms DESC,id DESC LIMIT 41"))?;
    let mut records=q.query_map(params![input.offset_minutes,now.timestamp_millis(),input.kind,input.search.trim(),input.start,input.end,before,before_id],|r|Ok(json!({"id":r.get::<_,String>(0)?,"targetId":r.get::<_,String>(1)?,"expression":r.get::<_,String>(2)?,"meaning":r.get::<_,String>(3)?,"kind":r.get::<_,String>(4)?,"occurredAtMs":r.get::<_,i64>(5)?,"detail":r.get::<_,String>(6)?,"date":r.get::<_,String>(7)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let more = records.len() > 40;
    records.truncate(40);
    let cursor = if more {
        let last = records.last().unwrap();
        json!({"beforeMs":last["occurredAtMs"],"beforeId":last["id"],"revision":revision})
    } else {
        Value::Null
    };
    let mut q=tx.prepare("SELECT local_date,source FROM local_checkins WHERE (?1 IS NULL OR local_date>=?1) AND (?2 IS NULL OR local_date<=?2) ORDER BY local_date DESC")?;
    let checkins = q
        .query_map(
            params![input.start, input.end.as_ref().unwrap_or(&today)],
            |r| Ok(json!({"date":r.get::<_,String>(0)?,"source":r.get::<_,String>(1)?})),
        )?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(
        json!({"revision":revision,"counts":counts,"days":days,"records":records,"nextCursor":cursor,"checkins":checkins}),
    )
}
