// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Internal Linux SDK compatibility smoke; never a shipping executable.

#[cfg(target_os = "linux")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_updater::UpdaterExt;
    if std::env::var("IMGCONVERT_INTERNAL_UPDATER_SMOKE").as_deref() != Ok("1") {
        return Err("internal smoke opt-in is required".into());
    }
    let root =
        std::path::PathBuf::from(std::env::var("IMGCONVERT_UPDATER_SMOKE_ROOT")?).canonicalize()?;
    if !root.join(".imgconvert-updater-smoke").is_file() {
        return Err("fixture marker missing".into());
    }
    let executable = root.join("tauri-old.AppImage").canonicalize()?;
    if !executable.starts_with(&root) {
        return Err("fixture path escapes the test root".into());
    }
    let endpoint = std::env::var("IMGCONVERT_UPDATER_SMOKE_ENDPOINT")?;
    let parsed: tauri::Url = endpoint.parse()?;
    if parsed.scheme() != "http"
        || parsed.host_str() != Some("127.0.0.1")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("only a loopback test endpoint is allowed".into());
    }
    let key = std::fs::read_to_string(root.join("test.key.pub"))?;
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.package_info_mut().version = "0.3.1".parse()?;
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": key.trim(), "endpoints": [], "dangerousInsecureTransportProtocol": true
        }),
    );
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)?;
    let updater = app
        .updater_builder()
        .executable_path(executable)
        .endpoints(vec![endpoint.parse()?])?
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    tauri::async_runtime::block_on(async move {
        let update = updater
            .check()
            .await?
            .ok_or("no update offered to the old SDK")?;
        if update.version != "0.4.1" {
            return Err("unexpected test version".into());
        }
        update.download_and_install(|_, _| {}, || {}).await?;
        Ok::<_, Box<dyn std::error::Error>>(())
    })?;
    println!("Tauri 0.3.x SDK verified and installed the cargo-packager AppImage");
    Ok(())
}
#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("This internal AppImage smoke is Linux-only");
}
