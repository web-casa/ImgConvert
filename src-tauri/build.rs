fn main() {
    println!("cargo:rerun-if-env-changed=IMGCONVERT_DISABLE_EXTERNAL_CODECS");
    println!("cargo:rerun-if-env-changed=IMGCONVERT_DISABLE_UPDATER");
    if std::env::var_os("CARGO_FEATURE_UPDATER").is_some() {
        tauri_build::build();
    } else {
        // The Mac App Store build omits the updater crate entirely. Restrict
        // Tauri's build-time ACL scan to the capability that remains valid
        // without that plugin, instead of validating updater.json.
        println!("cargo:rerun-if-changed=capabilities/default.json");
        tauri_build::try_build(
            tauri_build::Attributes::new().capabilities_path_pattern("capabilities/default.json"),
        )
        .expect("failed to generate the Store-only Tauri context");
    }
}
