fn main() {
    println!("cargo:rerun-if-env-changed=IMGCONVERT_DISABLE_EXTERNAL_CODECS");
    println!("cargo:rerun-if-env-changed=IMGCONVERT_DISABLE_UPDATER");
    tauri_build::build()
}
