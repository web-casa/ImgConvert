// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempParent = join(root, "target");
mkdirSync(tempParent, { recursive: true });
const tempRoot = mkdtempSync(join(tempParent, "external-codecs-ci-"));
const externalCodecsPath = resolve(root, "src-tauri", "src", "external_codecs.rs");
const windowsSystemCodecsPath = resolve(root, "src-tauri", "src", "windows_system_codecs.rs");

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? tempRoot,
    stdio: "inherit",
    env: process.env,
  });
}

try {
  writeFileSync(
    join(tempRoot, "Cargo.toml"),
    `[package]
name = "imgconvert-external-codecs-ci"
version = "0.0.0"
edition = "2021"
publish = false

[lib]
path = "lib.rs"

[workspace]

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.61.3", features = [
  "Win32_Foundation",
  "Win32_Graphics_Imaging",
  "Win32_System_Com",
  "Win32_System_Com_StructuredStorage",
] }
`,
  );

  const source = readFileSync(externalCodecsPath, "utf8")
    .replace(/^\/\/!/gm, "//")
    .replace(
      "use imgconvert_core::{validate_image_dimensions, MAX_PIXELS};",
      "use crate::imgconvert_core::{validate_image_dimensions, MAX_PIXELS};",
    )
    .replace("use imgconvert_core::RawMetadata;", "use crate::imgconvert_core::RawMetadata;");
  const windowsSystemCodecs = readFileSync(windowsSystemCodecsPath, "utf8").replace(
    /^\/\/!/gm,
    "//",
  );
  writeFileSync(
    join(tempRoot, "lib.rs"),
    `#![allow(dead_code)]
pub mod imgconvert_core {
    pub const MAX_PIXELS: usize = 64_000_000;

    #[derive(Debug, Clone)]
    pub struct RawMetadata {
        pub icc: Option<Vec<u8>>,
        pub exif: Option<Vec<u8>>,
        pub xmp: Option<Vec<u8>>,
        pub iptc: Option<Vec<u8>>,
    }

    impl RawMetadata {
        pub fn normalized_orientation(mut self) -> Self {
            if let Some(xmp) = self.xmp.take() {
                self.xmp = Some(match String::from_utf8(xmp) {
                    Ok(text) => strip_xmp_orientation_attributes(&text).into_bytes(),
                    Err(error) => error.into_bytes(),
                });
            }
            self
        }

        pub fn is_empty(&self) -> bool {
            self.icc.as_ref().is_none_or(Vec::is_empty)
                && self.exif.as_ref().is_none_or(Vec::is_empty)
                && self.xmp.as_ref().is_none_or(Vec::is_empty)
                && self.iptc.as_ref().is_none_or(Vec::is_empty)
        }
    }

    pub fn validate_image_dimensions(width: u32, height: u32) -> Result<(), &'static str> {
        if width == 0 || height == 0 {
            return Err("image dimensions must be non-zero");
        }
        let pixels = (width as usize)
            .checked_mul(height as usize)
            .ok_or("image dimensions overflow")?;
        if pixels > MAX_PIXELS {
            return Err("image exceeds the decoded-pixel budget");
        }
        Ok(())
    }

    fn strip_xmp_orientation_attributes(input: &str) -> String {
        let mut out = input.to_string();
        for name in ["tiff:Orientation", "exif:Orientation"] {
            while let Some(start) = out.find(name) {
                let after_name = start + name.len();
                let Some(eq_relative) = out[after_name..].find('=') else {
                    break;
                };
                let eq = after_name + eq_relative;
                if !out[after_name..eq].chars().all(char::is_whitespace) {
                    break;
                }
                let Some((quote_offset, quote)) = out[eq + 1..]
                    .char_indices()
                    .find(|(_, ch)| !ch.is_whitespace())
                else {
                    break;
                };
                if quote != '"' {
                    break;
                }
                let quote_start = eq + 1 + quote_offset;
                let Some(value_end_relative) = out[quote_start + 1..].find(quote) else {
                    break;
                };
                let mut remove_start = start;
                while remove_start > 0 && out.as_bytes()[remove_start - 1].is_ascii_whitespace() {
                    remove_start -= 1;
                }
                out.replace_range(remove_start..=quote_start + value_end_relative + 1, "");
            }
        }
        out
    }
}

pub mod external_codecs {
${source}
}
#[cfg(target_os = "windows")]
#[path = "windows_system_codecs.rs"]
pub mod windows_system_codecs;
`,
  );
  writeFileSync(join(tempRoot, "windows_system_codecs.rs"), windowsSystemCodecs);

  run("cargo", ["test", "--lib", "--", "--nocapture"]);
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
