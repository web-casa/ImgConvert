// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

use imgconvert_gpui::{init_app, open_main_window, probe_driver};
use imgconvert_gpui_shared::perf_probe;

fn main() {
    perf_probe::init();
    perf_probe::mark("main_start", None);

    let app = gpui_kit::application().with_assets(gpui_kit::assets::Assets);
    perf_probe::mark("rust_run", None);
    app.run(|cx| {
        init_app(cx);
        match open_main_window(cx) {
            Ok((window, workspace)) => {
                probe_driver::start(window, workspace, cx);
                cx.activate(true);
            }
            Err(error) => {
                eprintln!("imgconvert: cannot open the main window: {error:#}");
                cx.quit();
            }
        }
    });
}
