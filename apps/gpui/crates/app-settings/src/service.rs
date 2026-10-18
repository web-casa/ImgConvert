// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Direct AppImage updater. No production configuration is implicit. Check,
//! bounded download and signature validation precede the atomic replacement.

use super::{Driver, Offer};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use cargo_packager_updater::{
    RemoteRelease, UpdateFormat, reqwest::blocking::Client, semver::Version, url::Url,
};
use minisign_verify::{PublicKey, Signature};
use std::io::{Read as _, Write as _};
use std::path::PathBuf;
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use std::time::Duration;

const MANIFEST_LIMIT: u64 = 1024 * 1024;
const PACKAGE_LIMIT: u64 = 512 * 1024 * 1024;

struct ClientDriver {
    endpoint: Url,
    key: PublicKey,
    executable: PathBuf,
}

pub(super) fn configured_driver() -> Option<Arc<dyn Driver>> {
    if option_env!("IMGCONVERT_DISABLE_UPDATER") == Some("1") || !cfg!(target_os = "linux") {
        return None;
    }
    let endpoint: Url = option_env!("IMGCONVERT_UPDATER_ENDPOINT")?.parse().ok()?;
    if endpoint.scheme() != "https"
        || !endpoint.path().ends_with("/latest-v2.json")
        || endpoint.fragment().is_some()
        || endpoint.query().is_some()
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
    {
        return None;
    }
    let key = decode(option_env!("IMGCONVERT_UPDATER_PUBKEY")?).ok()?;
    let key = PublicKey::decode(&key).ok()?;
    let executable = PathBuf::from(std::env::var_os("APPIMAGE")?);
    let app_dir = PathBuf::from(std::env::var_os("APPDIR")?);
    if !std::env::current_exe().ok()?.starts_with(app_dir)
        || !executable.is_absolute()
        || !executable.is_file()
    {
        return None;
    }
    Some(Arc::new(ClientDriver {
        endpoint,
        key,
        executable,
    }))
}

fn decode(value: &str) -> Result<String, String> {
    String::from_utf8(STANDARD.decode(value.trim()).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn bounded_get(url: Url, limit: u64, progress: &AtomicU64) -> Result<Option<Vec<u8>>, String> {
    let client = Client::builder()
        .timeout(Duration::from_mins(2))
        .https_only(!cfg!(test))
        .redirect(cargo_packager_updater::reqwest::redirect::Policy::limited(
            5,
        ))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    if response.status().as_u16() == 204 {
        return Ok(None);
    }
    if response.content_length().is_some_and(|n| n > limit) {
        return Err("Update download exceeds the size limit".into());
    }
    let mut source = response.take(limit + 1);
    let mut bytes = Vec::new();
    let mut chunk = vec![0; 64 * 1024];
    loop {
        let count = source.read(&mut chunk).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..count]);
        progress.store(bytes.len() as u64, Ordering::Relaxed);
        if bytes.len() as u64 > limit {
            return Err("Update download exceeds the size limit".into());
        }
    }
    Ok(Some(bytes))
}

impl Driver for ClientDriver {
    fn check(&self) -> Result<Option<Offer>, String> {
        let Some(bytes) = bounded_get(self.endpoint.clone(), MANIFEST_LIMIT, &AtomicU64::new(0))?
        else {
            return Ok(None);
        };
        let manifest: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        imgconvert_platform::update_policy::validate_on_host(&manifest)
            .map_err(|error| error.to_string())?;
        let release: RemoteRelease = serde_json::from_value(manifest).map_err(|e| e.to_string())?;
        if release.version
            <= Version::parse(env!("CARGO_PKG_VERSION")).map_err(|e| e.to_string())?
        {
            return Ok(None);
        }
        let target = format!("linux-{}", std::env::consts::ARCH);
        let format = release.format(&target).map_err(|e| e.to_string())?;
        if !matches!(format, UpdateFormat::AppImage) {
            return Err("This channel requires an AppImage update".into());
        }
        let url = release
            .download_url(&target)
            .map_err(|e| e.to_string())?
            .clone();
        if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
            return Err("Update packages must use HTTPS".into());
        }
        Ok(Some(Offer {
            version: release.version.to_string(),
            notes: release.notes.clone().unwrap_or_default(),
            url: url.to_string(),
            signature: release
                .signature(&target)
                .map_err(|e| e.to_string())?
                .clone(),
        }))
    }

    fn download(&self, offer: &Offer, progress: &AtomicU64) -> Result<Vec<u8>, String> {
        let bytes = bounded_get(
            offer
                .url
                .parse()
                .map_err(|e: cargo_packager_updater::url::ParseError| e.to_string())?,
            PACKAGE_LIMIT,
            progress,
        )?
        .ok_or("Update download returned no package")?;
        let signature = Signature::decode(&decode(&offer.signature)?).map_err(|e| e.to_string())?;
        self.key
            .verify(&bytes, &signature, true)
            .map_err(|e| e.to_string())?;
        // Raw type-2 AppImage, never a tarball or an arbitrary signed file.
        if bytes.get(..4) != Some(b"\x7fELF") || bytes.get(8..11) != Some(b"AI\x02") {
            return Err("The signed update is not an AppImage".into());
        }
        let machine: u16 = match std::env::consts::ARCH {
            "x86_64" => 62,
            "aarch64" => 183,
            _ => return Err("Unsupported AppImage architecture".into()),
        };
        if bytes.get(4..6) != Some(&[2, 1])
            || bytes.get(18..20) != Some(machine.to_le_bytes().as_slice())
        {
            return Err("The signed update has the wrong architecture".into());
        }
        Ok(bytes)
    }

    fn install(&self, bytes: &[u8]) -> Result<(), String> {
        // Linux replacement uses rename over a fully synced file. Upstream
        // 0.2.3 writes to the final name after moving the old file away, which
        // could expose a partial executable if the application is killed.
        #[cfg(unix)]
        {
            let parent = self.executable.parent().ok_or("AppImage has no parent")?;
            let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
            file.as_file()
                .set_permissions(
                    std::fs::metadata(&self.executable)
                        .map_err(|e| e.to_string())?
                        .permissions(),
                )
                .map_err(|e| e.to_string())?;
            file.write_all(bytes).map_err(|e| e.to_string())?;
            file.as_file().sync_all().map_err(|e| e.to_string())?;
            file.persist(&self.executable).map_err(|e| e.to_string())?;
            Ok(())
        }
        #[cfg(not(unix))]
        {
            let _ = bytes;
            Err("AppImage installation is only supported on Linux".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    fn server(bytes: Vec<u8>, declared: Option<u64>) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let worker = thread::spawn(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            let mut stream = loop {
                if let Ok((stream, _)) = listener.accept() {
                    break stream;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "test server not contacted"
                );
                thread::sleep(Duration::from_millis(5));
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = [0; 2048];
            let _ = stream.read(&mut request).unwrap();
            write!(stream, "HTTP/1.1 200 OK\r\n").unwrap();
            if let Some(length) = declared {
                write!(stream, "Content-Length: {length}\r\n").unwrap();
            }
            write!(stream, "Connection: close\r\n\r\n").unwrap();
            let _ = stream.write_all(&bytes);
        });
        (format!("http://{address}/package"), worker)
    }

    fn fixture() -> (&'static [u8], &'static str) {
        if cfg!(target_arch = "aarch64") {
            (
                include_bytes!("../tests/fixtures/aarch64.bin"),
                include_str!("../tests/fixtures/aarch64.bin.sig"),
            )
        } else {
            (
                include_bytes!("../tests/fixtures/x86_64.bin"),
                include_str!("../tests/fixtures/x86_64.bin.sig"),
            )
        }
    }

    fn driver(path: PathBuf) -> ClientDriver {
        ClientDriver {
            endpoint: "https://example.invalid/latest-v2.json".parse().unwrap(),
            key: PublicKey::decode(
                &decode(include_str!("../tests/fixtures/test-key.pub")).unwrap(),
            )
            .unwrap(),
            executable: path,
        }
    }

    #[test]
    fn verifies_tauri_wrapped_signature_before_atomic_install() {
        let dir = tempfile::tempdir().unwrap();
        let executable = dir.path().join("ImgConvert.AppImage");
        std::fs::write(&executable, b"old executable").unwrap();
        let driver = driver(executable.clone());
        let (package, signature) = fixture();
        let (url, server) = server(package.to_vec(), None);
        let offer = Offer {
            version: "0.4.0".into(),
            notes: String::new(),
            url,
            signature: signature.into(),
        };
        let bytes = driver.download(&offer, &AtomicU64::new(0)).unwrap();
        assert_eq!(std::fs::read(&executable).unwrap(), b"old executable");
        #[cfg(unix)]
        {
            driver.install(&bytes).unwrap();
            assert_eq!(std::fs::read(&executable).unwrap(), package);
        }
        server.join().unwrap();
    }

    #[test]
    fn tampered_download_is_rejected_and_old_executable_survives() {
        let dir = tempfile::tempdir().unwrap();
        let executable = dir.path().join("ImgConvert.AppImage");
        std::fs::write(&executable, b"old executable").unwrap();
        let driver = driver(executable.clone());
        let (package, signature) = fixture();
        let mut corrupt = package.to_vec();
        corrupt[30] ^= 1;
        let (url, server) = server(corrupt, None);
        let offer = Offer {
            version: "0.4.0".into(),
            notes: String::new(),
            url,
            signature: signature.into(),
        };
        assert!(driver.download(&offer, &AtomicU64::new(0)).is_err());
        assert_eq!(std::fs::read(&executable).unwrap(), b"old executable");
        server.join().unwrap();
    }

    #[test]
    fn valid_signature_for_another_architecture_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let executable = dir.path().join("ImgConvert.AppImage");
        std::fs::write(&executable, b"old executable").unwrap();
        let driver = driver(executable.clone());
        let (package, signature): (&[u8], &str) = if cfg!(target_arch = "aarch64") {
            (
                include_bytes!("../tests/fixtures/x86_64.bin"),
                include_str!("../tests/fixtures/x86_64.bin.sig"),
            )
        } else {
            (
                include_bytes!("../tests/fixtures/aarch64.bin"),
                include_str!("../tests/fixtures/aarch64.bin.sig"),
            )
        };
        let (url, server) = server(package.to_vec(), None);
        let offer = Offer {
            version: "0.4.0".into(),
            notes: String::new(),
            url,
            signature: signature.into(),
        };
        let error = driver.download(&offer, &AtomicU64::new(0)).unwrap_err();
        assert!(error.contains("wrong architecture"), "{error}");
        assert_eq!(std::fs::read(&executable).unwrap(), b"old executable");
        server.join().unwrap();
    }

    #[test]
    fn oversize_response_is_rejected_before_reading_the_payload() {
        let (url, server) = server(Vec::new(), Some(PACKAGE_LIMIT + 1));
        assert!(
            bounded_get(url.parse().unwrap(), PACKAGE_LIMIT, &AtomicU64::new(0))
                .unwrap_err()
                .contains("size limit")
        );
        server.join().unwrap();
    }

    #[test]
    fn response_without_length_is_bounded_too() {
        // A small limit exercises the same streaming bound without allocating 512 MiB.
        let (url, server) = server(vec![0; 256], None);
        assert!(bounded_get(url.parse().unwrap(), 128, &AtomicU64::new(0)).is_err());
        server.join().unwrap();
    }
}
