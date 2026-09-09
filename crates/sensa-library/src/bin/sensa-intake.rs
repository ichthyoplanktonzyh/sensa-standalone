//! Narrow local intake transport. No network, model execution or arbitrary kernel commands.
use sensa_library::{intake, open_library};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};
const LIMIT: usize = 96 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    version: u32,
    library_path: PathBuf,
    library_id: String,
    client_id: String,
    label: String,
    extension_id: String,
}
fn option(args: &[String], name: &str) -> Result<String, String> {
    args.iter()
        .position(|s| s == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .ok_or_else(|| format!("missing_{name}"))
}
fn private_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "destination_exists_or_unavailable")?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "configuration_write_failed".into())
}
fn setup(args: &[String]) -> Result<Value, String> {
    let library =
        fs::canonicalize(option(args, "--library")?).map_err(|_| "library_unavailable")?;
    if !library.is_file() {
        return Err("library_unavailable".into());
    }
    let state = open_library(&library).map_err(|e| e.to_string())?;
    let extension = option(args, "--extension").unwrap_or_default();
    if !extension.is_empty()
        && (extension.len() != 32 || !extension.bytes().all(|b| (b'a'..=b'p').contains(&b)))
    {
        return Err("invalid_extension_id".into());
    }
    let label = option(args, "--label")?;
    if label.trim().is_empty() || label.chars().count() > 100 {
        return Err("invalid_label".into());
    }
    let directory = PathBuf::from(option(args, "--directory")?);
    fs::create_dir(&directory).map_err(|_| "connection_directory_must_be_new")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| "configuration_write_failed")?;
    }
    let directory = fs::canonicalize(directory).map_err(|_| "configuration_write_failed")?;
    let executable = directory.join(if cfg!(windows) {
        "sensa-intake.exe"
    } else {
        "sensa-intake"
    });
    fs::copy(
        std::env::current_exe().map_err(|_| "executable_unavailable")?,
        &executable,
    )
    .map_err(|_| "configuration_write_failed")?;
    let config = Config {
        version: 1,
        library_path: library,
        library_id: state.library_id,
        client_id: uuid::Uuid::new_v4().to_string(),
        label,
        extension_id: extension.clone(),
    };
    private_write(
        &directory.join("connection.json"),
        &serde_json::to_vec(&config).unwrap(),
    )?;
    let manifest = json!({"name":"app.sensa.intake","description":"Sensa local library intake","path":executable,"type":"stdio","allowed_origins":[format!("chrome-extension://{extension}/")]});
    if !extension.is_empty() {
        private_write(
            &directory.join("app.sensa.intake.json"),
            &serde_json::to_vec_pretty(&manifest).unwrap(),
        )?;
    }
    // Registration is explicit; this never silently replaces another selected library.
    if let Ok(destination) = option(args, "--manifest-dir") {
        if extension.is_empty() {
            return Err("invalid_extension_id".into());
        }
        let destination = PathBuf::from(destination);
        fs::create_dir_all(&destination).map_err(|_| "registration_failed")?;
        private_write(
            &destination.join("app.sensa.intake.json"),
            &serde_json::to_vec_pretty(&manifest).unwrap(),
        )?;
    }
    Ok(
        json!({"libraryId":config.library_id,"clientId":config.client_id,"label":config.label,"connection":directory.join("connection.json"),"manifest":if extension.is_empty(){None}else{Some(directory.join("app.sensa.intake.json"))}}),
    )
}
fn handle(c: &Config, value: Value, native: bool, allow_accept: bool) -> Result<Value, String> {
    let o = value.as_object().ok_or("invalid_request")?;
    let kind = value["kind"].as_str().ok_or("invalid_request")?;
    match kind {
        "hello" if o.len() == 1 => {
            if !c.library_path.is_file() {
                return Err("library_unavailable".into());
            }
            let s = open_library(&c.library_path).map_err(|e| e.to_string())?;
            if s.library_id != c.library_id {
                return Err("library_mismatch".into());
            }
            Ok(
                json!({"version":intake::VERSION,"libraryId":c.library_id,"clientId":c.client_id,"label":c.label}),
            )
        }
        "submit" if o.len() == 2 => {
            let r: intake::Request =
                serde_json::from_value(value["request"].clone()).map_err(|_| "invalid_request")?;
            if r.client_id != c.client_id || r.library_id != c.library_id {
                return Err("connection_mismatch".into());
            }
            if let Some(a) = &r.acceptance
                && (native && a.kind != "direct" || !native && !allow_accept)
            {
                return Err("explicit_acceptance_required".into());
            }
            intake::submit(&c.library_path, &r).map_err(|e| e.to_string())
        }
        "receipt" if o.len() == 4 => {
            if value["libraryId"] != c.library_id || value["clientId"] != c.client_id {
                return Err("connection_mismatch".into());
            }
            Ok(intake::receipt(
                &c.library_path,
                &c.library_id,
                &c.client_id,
                value["operationId"].as_str().ok_or("invalid_request")?,
            )
            .map_err(|e| e.to_string())?
            .unwrap_or(Value::Null))
        }
        _ => Err("unsupported_request".into()),
    }
}
fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|s| s == "--setup") {
        println!("{}", setup(&args)?);
        return Ok(());
    }
    if args.iter().any(|s| s == "--help") {
        println!(
            "Sensa local intake\nSetup: sensa-intake --setup --library PATH --label NAME --directory NEW_DIRECTORY [--extension CHROME_ID] [--manifest-dir PATH]\nCall: sensa-intake --config connection.json [--allow-accept] < request.json\nJSON actions: hello, submit, receipt. Acceptance requires explicit user authorization. No network or learning commands."
        );
        return Ok(());
    }
    let native = args
        .iter()
        .any(|s| s == "--native" || s.starts_with("chrome-extension://"));
    let config = option(&args, "--config").map(PathBuf::from).unwrap_or(
        std::env::current_exe()
            .map_err(|_| "configuration_unavailable")?
            .with_file_name("connection.json"),
    );
    let bytes = fs::read(config).map_err(|_| "configuration_unavailable")?;
    if bytes.len() > 8192 {
        return Err("invalid_configuration".into());
    }
    let c: Config = serde_json::from_slice(&bytes).map_err(|_| "invalid_configuration")?;
    if c.version != 1 {
        return Err("invalid_configuration".into());
    }
    if native
        && !args
            .iter()
            .any(|s| s == &format!("chrome-extension://{}/", c.extension_id))
    {
        return Err("extension_not_authorized".into());
    }
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    loop {
        let bytes = if native {
            let mut size = [0u8; 4];
            let first = input.read(&mut size[..1]).map_err(|_| "transport_failed")?;
            if first == 0 {
                break;
            }
            input
                .read_exact(&mut size[1..])
                .map_err(|_| "truncated_frame")?;
            let n = u32::from_le_bytes(size) as usize;
            if n == 0 || n > LIMIT {
                return Err("frame_too_large".into());
            }
            let mut bytes = vec![0; n];
            input
                .read_exact(&mut bytes)
                .map_err(|_| "truncated_frame")?;
            bytes
        } else {
            let mut bytes = vec![];
            input
                .by_ref()
                .take((LIMIT + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| "transport_failed")?;
            if bytes.len() > LIMIT {
                return Err("frame_too_large".into());
            }
            bytes
        };
        let result = serde_json::from_slice(&bytes)
            .map_err(|_| "invalid_json".into())
            .and_then(|v| handle(&c, v, native, args.iter().any(|s| s == "--allow-accept")));
        let failed = result.is_err();
        let reply = match result {
            Ok(value) => json!({"value":value}),
            Err(error) => json!({"error":error}),
        };
        let bytes = serde_json::to_vec(&reply).unwrap();
        if native {
            output
                .write_all(&(bytes.len() as u32).to_le_bytes())
                .map_err(|_| "transport_failed")?;
        }
        output
            .write_all(&bytes)
            .and_then(|_| output.flush())
            .map_err(|_| "transport_failed")?;
        if !native {
            if failed {
                std::process::exit(1);
            }
            break;
        }
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
