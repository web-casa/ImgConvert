// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Exact before/after workflow preview with bounded display payloads.

use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::access;
use crate::convert::{self, ConvertOptions, ConvertWarning};
use crate::pdf;

const DEFAULT_PREVIEW_EDGE: u32 = 1200;
const PREVIEW_MAGIC: [u8; 4] = *b"ICP1";
const PREVIEW_HEADER_BYTES: usize = 16;
const MAX_PREVIEW_SUMMARY_BYTES: usize = 64 * 1024;
const MAX_PREVIEW_IMAGE_BYTES: usize = 16 * 1024 * 1024;

/// Serializes full-resolution preview work with single/batch conversion. Cancellation cannot
/// interrupt a native encoder call, so a shared gate is required to keep their peak working sets
/// from overlapping while the cancelled call reaches its next safe boundary.
#[derive(Default)]
pub struct WorkflowExecutionGate {
    inner: Arc<Mutex<()>>,
}

impl WorkflowExecutionGate {
    pub fn handle(&self) -> Arc<Mutex<()>> {
        self.inner.clone()
    }
}

/// The workflow gate serializes peak-memory work but protects no mutable data. If a task panics
/// while holding it, recovering the unit guard is safe and prevents one failed task from disabling
/// every later conversion and preview for the lifetime of the process.
pub fn lock_workflow_execution_gate(execution: &Mutex<()>) -> MutexGuard<'_, ()> {
    match execution.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!(
                "ImgConvert recovered the workflow execution gate after a previous task panicked"
            );
            execution.clear_poison();
            poisoned.into_inner()
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewOptions {
    pub conversion: ConvertOptions,
    #[serde(default)]
    pub max_edge: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct PreviewResult {
    pub input: String,
    pub mime: &'static str,
    /// One-based PDF page shown by this preview; absent for ordinary images.
    pub source_page: Option<usize>,
    pub source_width: u32,
    pub source_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub output_size: u64,
    pub selected_quality: Option<u8>,
    pub target_size_met: Option<bool>,
    pub warnings: Vec<ConvertWarning>,
    pub before_bytes: Vec<u8>,
    pub after_bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewSummary<'a> {
    input: &'a str,
    mime: &'static str,
    source_page: Option<usize>,
    source_width: u32,
    source_height: u32,
    output_width: u32,
    output_height: u32,
    output_size: u64,
    selected_quality: Option<u8>,
    target_size_met: Option<bool>,
    warnings: &'a [ConvertWarning],
}

fn encode_ipc_payload(result: PreviewResult) -> Result<Vec<u8>, String> {
    if result.before_bytes.len() > MAX_PREVIEW_IMAGE_BYTES
        || result.after_bytes.len() > MAX_PREVIEW_IMAGE_BYTES
    {
        return Err("预览图片超过 IPC 安全上限".to_string());
    }

    let summary = serde_json::to_vec(&PreviewSummary {
        input: &result.input,
        mime: result.mime,
        source_page: result.source_page,
        source_width: result.source_width,
        source_height: result.source_height,
        output_width: result.output_width,
        output_height: result.output_height,
        output_size: result.output_size,
        selected_quality: result.selected_quality,
        target_size_met: result.target_size_met,
        warnings: &result.warnings,
    })
    .map_err(|error| format!("无法序列化预览摘要: {error}"))?;
    if summary.len() > MAX_PREVIEW_SUMMARY_BYTES {
        return Err("预览摘要超过 IPC 安全上限".to_string());
    }

    let summary_len =
        u32::try_from(summary.len()).map_err(|_| "预览摘要长度超出 IPC 协议范围".to_string())?;
    let before_len = u32::try_from(result.before_bytes.len())
        .map_err(|_| "源图预览长度超出 IPC 协议范围".to_string())?;
    let after_len = u32::try_from(result.after_bytes.len())
        .map_err(|_| "输出预览长度超出 IPC 协议范围".to_string())?;
    let capacity = PREVIEW_HEADER_BYTES
        .checked_add(summary.len())
        .and_then(|value| value.checked_add(result.before_bytes.len()))
        .and_then(|value| value.checked_add(result.after_bytes.len()))
        .ok_or_else(|| "预览 IPC 响应长度溢出".to_string())?;

    let mut payload = Vec::with_capacity(capacity);
    payload.extend_from_slice(&PREVIEW_MAGIC);
    payload.extend_from_slice(&summary_len.to_le_bytes());
    payload.extend_from_slice(&before_len.to_le_bytes());
    payload.extend_from_slice(&after_len.to_le_bytes());
    payload.extend_from_slice(&summary);
    payload.extend_from_slice(&result.before_bytes);
    payload.extend_from_slice(&result.after_bytes);
    Ok(payload)
}

pub fn into_ipc_response(result: PreviewResult) -> Result<tauri::ipc::Response, String> {
    encode_ipc_payload(result).map(tauri::ipc::Response::new)
}

#[derive(Default)]
pub struct PreviewState {
    current: Mutex<Option<PreviewHandle>>,
    next_id: AtomicU64,
}

struct PreviewHandle {
    id: u64,
    token: CancellationToken,
}

pub struct PreviewRegistration {
    id: u64,
    token: CancellationToken,
}

impl PreviewState {
    /// A newer preview replaces the previous generation. The old native call may finish, but its
    /// cancellation token prevents it from publishing at the next pipeline boundary.
    pub fn begin(&self) -> Result<PreviewRegistration, String> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "预览任务状态锁已损坏".to_string())?;
        if let Some(previous) = current.as_ref() {
            previous.token.cancel();
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let token = CancellationToken::new();
        *current = Some(PreviewHandle {
            id,
            token: token.clone(),
        });
        Ok(PreviewRegistration { id, token })
    }

    pub fn finish(&self, id: u64) {
        if let Ok(mut current) = self.current.lock() {
            if current.as_ref().is_some_and(|handle| handle.id == id) {
                *current = None;
            }
        }
    }

    pub fn cancel_current(&self) -> bool {
        if let Ok(current) = self.current.lock() {
            if let Some(handle) = current.as_ref() {
                handle.token.cancel();
                return true;
            }
        }
        false
    }
}

impl PreviewRegistration {
    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

pub fn generate_preview(
    options: PreviewOptions,
    cancel: CancellationToken,
) -> Result<PreviewResult, String> {
    let input_value = options.conversion.input.clone();
    let grant = access::user_selected_path(&input_value)
        .map_err(|error| format!("无法解析预览输入路径: {error}"))?;
    let _input_scope = grant.scoped_access();
    let input = grant.path();
    let metadata = fs::metadata(input).map_err(|error| format!("无法读取预览文件信息: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("预览输入路径不是文件: {input_value}"));
    }
    if cancel.is_cancelled() {
        return Err("预览已取消".to_string());
    }

    let max_edge = options.max_edge.unwrap_or(DEFAULT_PREVIEW_EDGE);
    let is_cancelled = || cancel.is_cancelled();
    let (source_width, source_height, source_page, workflow, mut pdf_warnings) =
        if pdf::is_pdf_path(input) {
            let document = pdf::PdfDocument::load(pdf::read_pdf_file(input)?)?;
            let selection = document.selection(options.conversion.pdf.as_ref())?;
            let page_index = *selection
                .pages
                .first()
                .ok_or_else(|| "PDF 页码范围未选择任何页面".to_string())?;
            let cache = document.new_render_cache();
            let rendered = document.render_page(page_index, selection.dpi, &cache)?;
            let dimensions = (rendered.image.width, rendered.image.height);
            let warnings = (rendered.warning_count > 0)
                .then(|| ConvertWarning::PdfRenderWarnings {
                    page: page_index + 1,
                    count: rendered.warning_count,
                })
                .into_iter()
                .collect();
            let workflow = convert::convert_image_workflow(
                &options.conversion,
                rendered.image,
                Some(max_edge),
                Some(&is_cancelled),
            )?;
            (
                dimensions.0,
                dimensions.1,
                Some(page_index + 1),
                workflow,
                warnings,
            )
        } else {
            let source = convert::read_source_for_core(input)?;
            let source_probe =
                imgconvert_core::probe(&source.bytes).map_err(|error| error.to_string())?;
            let workflow = convert::convert_source_workflow(
                &options.conversion,
                &source.bytes,
                source.metadata_override.as_ref(),
                Some(max_edge),
                Some(&is_cancelled),
            )?;
            (
                source_probe.width,
                source_probe.height,
                None,
                workflow,
                Vec::new(),
            )
        };
    if cancel.is_cancelled() {
        return Err("预览已取消".to_string());
    }

    let output_size = u64::try_from(workflow.bytes.len()).unwrap_or(u64::MAX);
    let before_bytes = workflow
        .source_preview_png
        .ok_or_else(|| "core 未返回源图预览".to_string())?;
    let after_bytes = workflow
        .output_preview_png
        .ok_or_else(|| "core 未返回输出预览".to_string())?;
    pdf_warnings.extend(
        workflow
            .warnings
            .iter()
            .map(convert::convert_workflow_warning),
    );
    Ok(PreviewResult {
        input: input_value,
        mime: "image/png",
        source_page,
        source_width,
        source_height,
        output_width: workflow.width,
        output_height: workflow.height,
        output_size,
        selected_quality: workflow.selected_quality,
        target_size_met: workflow.target_size_met,
        warnings: pdf_warnings,
        before_bytes,
        after_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use imgconvert_core::{codec_for, EncodeOptions, Format, ImageData};
    use std::path::PathBuf;
    use std::sync::TryLockError;

    fn test_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("imgconvert-preview-{label}-{}", std::process::id()))
    }

    #[test]
    fn newer_preview_cancels_the_previous_generation() {
        let state = PreviewState::default();
        let first = state.begin().unwrap();
        let second = state.begin().unwrap();
        assert!(first.token().is_cancelled());
        assert!(!second.token().is_cancelled());
        assert!(second.id() > first.id());
        state.finish(first.id());
        assert!(state.cancel_current());
        state.finish(second.id());
        assert!(!state.cancel_current());
    }

    #[test]
    fn workflow_execution_gate_handles_share_the_same_lock() {
        let gate = WorkflowExecutionGate::default();
        let first = gate.handle();
        let second = gate.handle();
        let _guard = first.lock().unwrap();

        assert!(matches!(second.try_lock(), Err(TryLockError::WouldBlock)));
    }

    #[test]
    fn workflow_execution_gate_recovers_after_a_holder_panics() {
        let gate = WorkflowExecutionGate::default();
        let execution = gate.handle();
        let poisoned = execution.clone();

        let panicked = std::thread::spawn(move || {
            let _guard = poisoned.lock().unwrap();
            panic!("simulated workflow panic");
        })
        .join();

        assert!(panicked.is_err());
        assert!(execution.is_poisoned());
        drop(lock_workflow_execution_gate(&execution));
        assert!(!execution.is_poisoned());
        assert!(execution.try_lock().is_ok());
    }

    #[test]
    fn preview_ipc_response_uses_a_bounded_binary_envelope() {
        let payload = encode_ipc_payload(PreviewResult {
            input: "/tmp/source.png".to_string(),
            mime: "image/png",
            source_page: None,
            source_width: 4,
            source_height: 2,
            output_width: 2,
            output_height: 1,
            output_size: 321,
            selected_quality: Some(77),
            target_size_met: Some(true),
            warnings: Vec::new(),
            before_bytes: vec![1, 2, 3],
            after_bytes: vec![4, 5],
        })
        .unwrap();

        assert_eq!(&payload[..4], b"ICP1");
        let summary_len = u32::from_le_bytes(payload[4..8].try_into().unwrap()) as usize;
        let before_len = u32::from_le_bytes(payload[8..12].try_into().unwrap()) as usize;
        let after_len = u32::from_le_bytes(payload[12..16].try_into().unwrap()) as usize;
        assert_eq!((before_len, after_len), (3, 2));
        assert_eq!(payload.len(), PREVIEW_HEADER_BYTES + summary_len + 3 + 2);
        let summary: serde_json::Value =
            serde_json::from_slice(&payload[PREVIEW_HEADER_BYTES..][..summary_len]).unwrap();
        assert_eq!(summary["selectedQuality"], 77);
        assert_eq!(summary["outputSize"], 321);
        assert!(summary["sourcePage"].is_null());
        assert_eq!(&payload[payload.len() - 5..], &[1, 2, 3, 4, 5]);
    }

    #[test]
    fn preview_ipc_response_rejects_oversized_images() {
        let error = encode_ipc_payload(PreviewResult {
            input: "/tmp/source.png".to_string(),
            mime: "image/png",
            source_page: None,
            source_width: 1,
            source_height: 1,
            output_width: 1,
            output_height: 1,
            output_size: 0,
            selected_quality: None,
            target_size_met: None,
            warnings: Vec::new(),
            before_bytes: vec![0; MAX_PREVIEW_IMAGE_BYTES + 1],
            after_bytes: Vec::new(),
        })
        .unwrap_err();

        assert!(error.contains("安全上限"));
    }

    #[test]
    fn preview_runs_exact_workflow_without_writing_output() {
        let dir = test_dir("exact");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("source.png");
        let image = ImageData::new(4, 2, vec![180; 4 * 2 * 4]).unwrap();
        let png = codec_for(Format::Png)
            .encode(&image, &EncodeOptions::default())
            .unwrap();
        fs::write(&input, png).unwrap();

        let conversion = convert::path_conversion_smoke_options(
            input.to_string_lossy().to_string(),
            Some(dir.to_string_lossy().to_string()),
            "jpeg".to_string(),
        );
        let result = generate_preview(
            PreviewOptions {
                conversion,
                max_edge: Some(imgconvert_core::MIN_WORKFLOW_PREVIEW_EDGE),
            },
            CancellationToken::new(),
        )
        .unwrap();

        assert_eq!((result.source_width, result.source_height), (4, 2));
        assert_eq!(result.source_page, None);
        assert_eq!((result.output_width, result.output_height), (4, 2));
        assert!(result.before_bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(result.after_bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(!dir.join("source-imgconvert-smoke.jpg").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn preview_uses_the_first_selected_pdf_page_without_writing_outputs() {
        let dir = test_dir("pdf");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("source.pdf");
        fs::write(&input, crate::pdf::tests::minimal_pdf(2)).unwrap();
        let mut conversion = convert::path_conversion_smoke_options(
            input.to_string_lossy().to_string(),
            Some(dir.to_string_lossy().to_string()),
            "png".to_string(),
        );
        conversion.pdf = Some(crate::pdf::PdfConvertOptions {
            dpi: 72,
            page_range: Some("2".to_string()),
        });

        let result = generate_preview(
            PreviewOptions {
                conversion,
                max_edge: Some(imgconvert_core::MIN_WORKFLOW_PREVIEW_EDGE),
            },
            CancellationToken::new(),
        )
        .unwrap();

        assert_eq!((result.source_width, result.source_height), (72, 72));
        assert_eq!(result.source_page, Some(2));
        assert!(result.before_bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(!dir.join("source-imgconvert-smoke-page-002.png").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
