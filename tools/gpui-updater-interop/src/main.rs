// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

fn main() -> Result<(), Box<dyn std::error::Error>> {
    use cargo_packager_updater::{Config, UpdaterBuilder};
    if !cfg!(target_os = "linux") {
        return Err("this internal AppImage smoke is Linux-only".into());
    }
    if std::env::var("IMGCONVERT_INTERNAL_UPDATER_SMOKE").as_deref() != Ok("1") {
        return Err("internal smoke opt-in is required".into());
    }
    let root =
        std::path::PathBuf::from(std::env::var("IMGCONVERT_UPDATER_SMOKE_ROOT")?).canonicalize()?;
    if !root.join(".imgconvert-updater-smoke").is_file() {
        return Err("fixture marker missing".into());
    }
    let executable = root.join("gpui-old.AppImage").canonicalize()?;
    if !executable.starts_with(&root) {
        return Err("fixture path escapes the test root".into());
    }
    let endpoint = std::env::var("IMGCONVERT_UPDATER_SMOKE_ENDPOINT")?;
    let parsed: cargo_packager_updater::url::Url = endpoint.parse()?;
    if parsed.scheme() != "http"
        || parsed.host_str() != Some("127.0.0.1")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("only a loopback endpoint is allowed".into());
    }
    let key = std::fs::read_to_string(root.join("test.key.pub"))?;
    let config = Config {
        endpoints: vec![endpoint.parse()?],
        pubkey: key.trim().into(),
        ..Default::default()
    };
    let update = UpdaterBuilder::new("0.4.0-poc.1".parse()?, config)
        .executable_path(executable)
        .timeout(std::time::Duration::from_secs(30))
        .build()?
        .check()?
        .ok_or("new SDK did not find the update")?;
    if update.version != "0.4.1" {
        return Err("unexpected test version".into());
    }
    update.download_and_install()?;
    println!("cargo-packager-updater 0.2.3 verified and installed the same signed AppImage");
    Ok(())
}
