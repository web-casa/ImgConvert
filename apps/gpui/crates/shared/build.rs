// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

fn main() {
    // rust-i18n reads these files from its procedural macro; Cargo must also
    // track them so locale-only edits rebuild the embedded translations.
    println!("cargo:rerun-if-changed=locales");
}
