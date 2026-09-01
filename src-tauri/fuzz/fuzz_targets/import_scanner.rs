// SPDX-License-Identifier: Apache-2.0

#![no_main]

use libfuzzer_sys::fuzz_target;
use tauri_app_lib::fuzz_import_scan_bytes;

fuzz_target!(|data: &[u8]| {
    fuzz_import_scan_bytes(data);
});
