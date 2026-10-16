// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Queue feature: importing files, the virtualized queue list and bounded
//! thumbnail loading. The retained state is `shared::QueueModel`; this crate
//! owns the import workflow and the presentation.

pub mod import;
pub mod queue_view;
pub mod thumbnails;

pub use queue_view::QueueView;
