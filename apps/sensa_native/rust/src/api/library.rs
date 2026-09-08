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
