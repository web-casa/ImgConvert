// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

fn main() {
    // Store builds compile external codec discovery off; the flag is read with
    // `option_env!` in external_codecs.rs, so this crate must rebuild when it changes.
    println!("cargo:rerun-if-env-changed=IMGCONVERT_DISABLE_EXTERNAL_CODECS");
}
