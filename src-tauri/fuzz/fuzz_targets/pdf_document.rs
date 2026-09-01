// SPDX-License-Identifier: Apache-2.0

#![no_main]

use libfuzzer_sys::fuzz_target;
use tauri_app_lib::fuzz_pdf_document;

const MAX_PDF_BYTES: usize = 1024 * 1024;

fuzz_target!(|data: &[u8]| {
    if data.len() <= MAX_PDF_BYTES {
        fuzz_pdf_document(data);
    }
});
