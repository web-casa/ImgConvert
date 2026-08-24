// SPDX-License-Identifier: Apache-2.0

//! Verify the updater artifacts exactly as Tauri's updater plugin does.
//!
//! The Tauri configuration stores the Minisign public-key text in an outer
//! base64 wrapper, and Tauri signs each updater artifact with the same wrapper
//! around the `.sig` contents. Keeping the decoder and `allow_legacy` setting
//! aligned with `tauri-plugin-updater` makes this an end-to-end release check
//! instead of a mere signature-file presence check.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process,
};

const DEFAULT_PROFILE: &str = "release";

struct Options {
    profile: String,
    bundle_root: Option<PathBuf>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("verify-updater-signatures: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let options = parse_options()?;
    let public_key = read_public_key()?;
    let artifact_directory = options.bundle_root.unwrap_or_else(|| {
        PathBuf::from("src-tauri")
            .join("target")
            .join(options.profile)
            .join("bundle")
            .join("appimage")
    });
    let artifacts = updater_artifacts(&artifact_directory)?;

    for artifact in &artifacts {
        verify_artifact(&public_key, artifact)?;
        println!("Verified updater signature: {}", artifact.display());
    }

    Ok(())
}

fn parse_options() -> Result<Options, String> {
    let mut options = Options {
        profile: DEFAULT_PROFILE.to_string(),
        bundle_root: None,
    };

    for argument in env::args().skip(1) {
        if argument == "--" {
            continue;
        }
        if argument == "--help" {
            println!("Usage: verify_updater_signatures [--profile=release] [--bundle-root=PATH]");
            process::exit(0);
        }
        if let Some(profile) = argument.strip_prefix("--profile=") {
            if !is_safe_profile(profile) {
                return Err(format!("invalid profile: {profile}"));
            }
            options.profile = profile.to_string();
            continue;
        }
        if let Some(bundle_root) = argument.strip_prefix("--bundle-root=") {
            if bundle_root.is_empty() {
                return Err("--bundle-root must not be empty".to_string());
            }
            options.bundle_root = Some(PathBuf::from(bundle_root));
            continue;
        }
        return Err(format!("unknown argument: {argument}"));
    }

    Ok(options)
}

fn is_safe_profile(profile: &str) -> bool {
    !profile.is_empty()
        && profile
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

fn read_public_key() -> Result<PublicKey, String> {
    let encoded = env::var("TAURI_UPDATER_PUBKEY")
        .map_err(|_| "TAURI_UPDATER_PUBKEY is required to verify updater signatures".to_string())?;
    let decoded = tauri_base64_to_string(&encoded, "TAURI_UPDATER_PUBKEY")?;
    PublicKey::decode(&decoded)
        .map_err(|error| format!("cannot decode Tauri updater public key: {error}"))
}

fn updater_artifacts(directory: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = fs::read_dir(directory).map_err(|error| {
        format!(
            "cannot read updater artifact directory {}: {error}",
            directory.display()
        )
    })?;
    let mut artifacts = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "cannot inspect updater artifact directory {}: {error}",
                directory.display()
            )
        })?;
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "cannot inspect updater artifact {}: {error}",
                entry.path().display()
            )
        })?;
        let artifact = entry.path();
        if file_type.is_file()
            && artifact
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".AppImage"))
        {
            artifacts.push(artifact);
        }
    }

    artifacts.sort();
    if artifacts.len() != 1 {
        return Err(format!(
            "expected exactly one updater AppImage in {}, found {}",
            directory.display(),
            artifacts.len()
        ));
    }
    Ok(artifacts)
}

fn verify_artifact(public_key: &PublicKey, artifact: &Path) -> Result<(), String> {
    let signature_path = PathBuf::from(format!("{}.sig", artifact.display()));
    let encoded_signature = fs::read_to_string(&signature_path).map_err(|error| {
        format!(
            "cannot read updater signature {}: {error}",
            signature_path.display()
        )
    })?;
    let decoded_signature = tauri_base64_to_string(&encoded_signature, "updater signature")?;
    let signature = Signature::decode(&decoded_signature).map_err(|error| {
        format!(
            "cannot decode updater signature {}: {error}",
            signature_path.display()
        )
    })?;
    let bytes = fs::read(artifact).map_err(|error| {
        format!(
            "cannot read updater artifact {}: {error}",
            artifact.display()
        )
    })?;

    // This mirrors `tauri-plugin-updater`'s `verify_signature` call exactly.
    public_key
        .verify(&bytes, &signature, true)
        .map_err(|error| {
            format!(
                "updater signature does not verify for {}: {error}",
                artifact.display()
            )
        })
}

fn tauri_base64_to_string(encoded: &str, label: &str) -> Result<String, String> {
    let decoded = STANDARD
        .decode(encoded.trim())
        .map_err(|error| format!("{label} is not valid base64: {error}"))?;
    String::from_utf8(decoded).map_err(|error| format!("{label} is not UTF-8: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{tauri_base64_to_string, verify_artifact, PublicKey, Signature, STANDARD};
    use base64::Engine as _;
    use std::{fs, path::PathBuf};

    const PUBLIC_KEY: &str = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
    const SIGNATURE: &str = "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1633700835\tfile:test\tprehashed\nwLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJpIidRJnp94ABQkJAgAooBQ==";

    #[test]
    fn verifies_the_tauri_wrapped_minisign_fixture() {
        let public_key = PublicKey::decode(
            &tauri_base64_to_string(&STANDARD.encode(PUBLIC_KEY), "public key").unwrap(),
        )
        .unwrap();
        let signature = Signature::decode(
            &tauri_base64_to_string(&STANDARD.encode(SIGNATURE), "signature").unwrap(),
        )
        .unwrap();

        public_key.verify(b"test", &signature, true).unwrap();
    }

    #[test]
    fn rejects_a_changed_updater_artifact() {
        let directory = temp_test_directory();
        let artifact = directory.join("ImgConvert.AppImage");
        fs::write(&artifact, b"changed").unwrap();
        fs::write(
            format!("{}.sig", artifact.display()),
            STANDARD.encode(SIGNATURE),
        )
        .unwrap();
        let public_key = PublicKey::decode(PUBLIC_KEY).unwrap();

        let error = verify_artifact(&public_key, &artifact).unwrap_err();

        assert!(error.contains("does not verify"));
        fs::remove_dir_all(directory).unwrap();
    }

    fn temp_test_directory() -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "imgconvert-verify-updater-signatures-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&directory).unwrap();
        directory
    }
}
