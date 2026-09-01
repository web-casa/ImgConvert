// SPDX-License-Identifier: Apache-2.0

#![no_main]

use libfuzzer_sys::fuzz_target;
use tauri_app_lib::fuzz_external_codec_manifest;

const MAX_MANIFEST_BYTES: usize = 64 * 1024;

fuzz_target!(|data: &[u8]| {
    if data.len() <= MAX_MANIFEST_BYTES {
        fuzz_external_codec_manifest(data);
    }
});
