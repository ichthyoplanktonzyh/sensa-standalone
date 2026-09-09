use std::path::Path;

/// Runs off the UI thread through the generated async bridge.
pub fn library_snapshot(path: String) -> anyhow::Result<String> {
    Ok(serde_json::to_string(&sensa_library::open_library(Path::new(&path))?)?)
}

pub fn library_command(path: String, command_json: String) -> anyhow::Result<String> {
    let command: sensa_library::Command = serde_json::from_str(&command_json)?;
    Ok(serde_json::to_string(&sensa_library::execute(Path::new(&path), command)?)?)
}

#[flutter_rust_bridge::frb(init)]
pub fn init_app() {
    flutter_rust_bridge::setup_default_user_utils();
}

/// Returns verified packaged media for the current local encounter only.
pub fn library_assurance_media(path:String,session_id:String,reference:String)->anyhow::Result<Vec<u8>> {
    Ok(sensa_library::read_assurance_media(Path::new(&path),&session_id,&reference)?)
}

/// Replaceable verified byte cache; does not write learning facts or operation receipts.
pub fn library_cache_pronunciation(path:String,material_id:String,bytes:Vec<u8>)->anyhow::Result<()> {
    Ok(sensa_library::pronunciation::cache(Path::new(&path),&material_id,&bytes)?)
}

pub fn library_cached_pronunciation(path:String,material_id:String)->anyhow::Result<Vec<u8>> {
    Ok(sensa_library::pronunciation::cached(Path::new(&path),&material_id)?)
}

/// Paginated local completion facts; does not execute a domain command.
pub fn library_history(path:String,query_json:String)->anyhow::Result<String> {
 Ok(serde_json::to_string(&sensa_library::history::query(Path::new(&path),serde_json::from_str(&query_json)?)?)?)
}

pub fn library_practice(path:String)->anyhow::Result<String> {
 Ok(sensa_library::practice::query(Path::new(&path))?.to_string())
}
pub fn library_practice_command(path:String,command_json:String)->anyhow::Result<String> {
 Ok(sensa_library::practice::execute(Path::new(&path),serde_json::from_str(&command_json)?)?.to_string())
}

pub fn library_world(path:String)->anyhow::Result<String> {
 Ok(sensa_library::world::query(Path::new(&path))?.to_string())
}
pub fn library_world_put_media(path:String,bytes:Vec<u8>)->anyhow::Result<String> {
 Ok(sensa_library::world::put_media(Path::new(&path),&bytes)?)
}
pub fn library_world_media(path:String,digest:String)->anyhow::Result<Vec<u8>> {
 Ok(sensa_library::world::media(Path::new(&path),&digest)?)
}
