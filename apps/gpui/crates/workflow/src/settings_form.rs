// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The conversion settings form (port of the Svelte `SettingsBar` and
//! `WorkflowSettings`): format and quality always visible, then ten
//! collapsible sections (output, compression, color, cache, format
//! parameters, presets, PDF, resize, target size, metadata), one open at a
//! time. Section headers are Kit `Button`s so every section is a Tab stop;
//! sliders get a focus handle and arrow keys because Kit's `Slider` is
//! pointer-only in 0.7.1.
//!
//! Every control is controlled by the persisted [`SettingsModel`]: a control
//! reports a requested value, the model is updated (which schedules the
//! autosave), and [`SettingsForm::sync_controls`] mirrors the record back
//! into Kit's retained control states. The `syncing` flag keeps that mirror
//! from being reported as a user edit. A text field that has focus is left
//! to the person typing in it; explicit commits (Enter, blur, normalization)
//! reconcile that one field themselves.

use gpui_kit::component::button::{Button, ButtonVariant, ButtonVariants as _};
use gpui_kit::component::collapsible::Collapsible;
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::select::{Select, SelectEvent};
use gpui_kit::component::slider::{Slider, SliderEvent, SliderState};
use gpui_kit::component::switch::Switch;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, Icon, IconName, Sizable as _, WindowExt as _, h_flex,
    v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    App, AppContext as _, Context, Div, Entity, FocusHandle, Focusable as _, FontWeight,
    InteractiveElement as _, IntoElement, KeyDownEvent, ParentElement as _, Render, SharedString,
    StatefulInteractiveElement as _, Styled as _, Subscription, TestSupportExt as _, Window, div,
    transparent_black,
};
use imgconvert_backend::conversion_request::{
    self, PdfPageRangeError, effective_quality_for, quality_floor_for,
};
use imgconvert_backend::convert;
use imgconvert_backend::result_cache;
use imgconvert_backend::settings::{
    AvifSubsample, ColorManagementPolicy, DEFAULT_OUTPUT_SUFFIX, MAX_CUSTOM_PRESETS, MAX_PDF_DPI,
    MAX_PDF_PAGE_RANGE_CHARS, MAX_RESIZE_PERCENT, MAX_TARGET_SIZE_KIB, MIN_PDF_DPI,
    MIN_TARGET_SIZE_KIB, MetadataPolicy, OverwriteMode, ResizeMode, Settings,
    Theme as ThemePreference, normalize_output_suffix_input,
};
use imgconvert_backend::workflow_presets::{
    self, CUSTOM_PRESET_ID_PREFIX, builtin_workflow_presets,
};
use imgconvert_gpui_shared::choice::{Choice, ChoiceItem};
use imgconvert_gpui_shared::i18n::{Locale, tr, tr_with};
use imgconvert_gpui_shared::{AppModels, BatchModel, QueueModel, SettingsModel};

/// Sentinel id of the preset select when no preset matches.
const CUSTOM_PRESET_VALUE: &str = "__custom";

/// Sections of the form, in display order. One is open at a time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Section {
    Output,
    Compression,
    Color,
    Cache,
    FormatParameters,
    Presets,
    Pdf,
    Resize,
    TargetSize,
    Metadata,
    Appearance,
}

impl Section {
    pub const ALL: [Self; 11] = [
        Self::Output,
        Self::Compression,
        Self::Color,
        Self::Cache,
        Self::FormatParameters,
        Self::Presets,
        Self::Pdf,
        Self::Resize,
        Self::TargetSize,
        Self::Metadata,
        Self::Appearance,
    ];

    /// Element id of the section's header button.
    pub fn id(self) -> &'static str {
        match self {
            Self::Output => "section-output",
            Self::Compression => "section-compression",
            Self::Color => "section-color",
            Self::Cache => "section-cache",
            Self::FormatParameters => "section-format-parameters",
            Self::Presets => "section-presets",
            Self::Pdf => "section-pdf",
            Self::Resize => "section-resize",
            Self::TargetSize => "section-target-size",
            Self::Metadata => "section-metadata",
            Self::Appearance => "section-appearance",
        }
    }

    fn title_key(self) -> &'static str {
        match self {
            Self::Output => "settings.output_section",
            Self::Compression => "settings.compression_section",
            Self::Color => "settings.color_section",
            Self::Cache => "settings.result_cache_label",
            Self::FormatParameters => "settings.format_parameters",
            Self::Presets => "workflow.preset",
            Self::Pdf => "workflow.pdf_section",
            Self::Resize => "workflow.resize_section",
            Self::TargetSize => "workflow.target_section",
            Self::Metadata => "workflow.metadata_section",
            Self::Appearance => "settings.appearance_section",
        }
    }
}

/// Numeric text fields, committed on Enter or blur like the Svelte inputs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NumberField {
    ResizeWidth,
    ResizeHeight,
    ResizeValue,
    TargetSizeKib,
    PdfDpi,
}

impl NumberField {
    const ALL: [Self; 5] = [
        Self::PdfDpi,
        Self::ResizeWidth,
        Self::ResizeHeight,
        Self::ResizeValue,
        Self::TargetSizeKib,
    ];

    fn text(self, settings: &Settings) -> String {
        match self {
            Self::ResizeWidth => settings.resize_width.to_string(),
            Self::ResizeHeight => settings.resize_height.to_string(),
            Self::ResizeValue => settings.resize_value.to_string(),
            Self::TargetSizeKib => settings.target_size_kib.to_string(),
            Self::PdfDpi => settings.pdf_dpi.to_string(),
        }
    }
}

/// The sliders of the form; each maps one settings field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SliderKind {
    Quality,
    Concurrency,
    PngOxipngLevel,
    PngQuantColors,
    WebpMethod,
    WebpNearLossless,
    AvifSpeed,
    AutoQualityScore,
    QualityFloor,
}

impl SliderKind {
    pub const ALL: [Self; 9] = [
        Self::Quality,
        Self::Concurrency,
        Self::PngOxipngLevel,
        Self::PngQuantColors,
        Self::WebpMethod,
        Self::WebpNearLossless,
        Self::AvifSpeed,
        Self::AutoQualityScore,
        Self::QualityFloor,
    ];

    fn range(self) -> (f32, f32) {
        match self {
            Self::Quality => (1., 100.),
            Self::Concurrency => (0., 8.),
            Self::PngOxipngLevel | Self::WebpMethod => (0., 6.),
            Self::PngQuantColors => (64., 256.),
            Self::WebpNearLossless | Self::QualityFloor => (0., 100.),
            Self::AvifSpeed => (0., 10.),
            Self::AutoQualityScore => (50., 95.),
        }
    }

    /// Element id of the keyboard-focusable wrapper.
    pub fn id(self) -> &'static str {
        match self {
            Self::Quality => "settings-quality",
            Self::Concurrency => "settings-concurrency",
            Self::PngOxipngLevel => "settings-png-oxipng-level",
            Self::PngQuantColors => "settings-png-quant-colors",
            Self::WebpMethod => "settings-webp-method",
            Self::WebpNearLossless => "settings-webp-near-lossless",
            Self::AvifSpeed => "settings-avif-speed",
            Self::AutoQualityScore => "settings-auto-quality-score",
            Self::QualityFloor => "settings-quality-floor",
        }
    }

    /// The field's current value in `settings`.
    fn value(self, settings: &Settings) -> f32 {
        match self {
            Self::Quality => f32::from(settings.quality),
            Self::Concurrency => f32::from(settings.concurrency),
            Self::PngOxipngLevel => f32::from(settings.png_oxipng_level),
            Self::PngQuantColors => f32::from(settings.png_quant_colors),
            Self::WebpMethod => f32::from(settings.webp_method),
            Self::WebpNearLossless => f32::from(settings.webp_near_lossless),
            Self::AvifSpeed => f32::from(settings.avif_speed),
            Self::AutoQualityScore => f32::from(settings.auto_quality_score),
            Self::QualityFloor => f32::from(quality_floor_for(settings, &settings.format)),
        }
    }

    /// Writes a slider position (rounded, non-negative) to the field with
    /// the same clamps the Svelte commit handlers apply.
    fn apply(self, settings: &mut Settings, value: u16) {
        match self {
            Self::Quality => settings.quality = value.clamp(1, 100) as u8,
            Self::Concurrency => settings.concurrency = value.min(8) as u8,
            Self::PngOxipngLevel => settings.png_oxipng_level = value.min(6) as u8,
            Self::PngQuantColors => settings.png_quant_colors = value.clamp(64, 256),
            Self::WebpMethod => settings.webp_method = value.min(6) as u8,
            Self::WebpNearLossless => settings.webp_near_lossless = value.min(100) as u8,
            Self::AvifSpeed => settings.avif_speed = value.min(10) as u8,
            Self::AutoQualityScore => settings.auto_quality_score = value.clamp(50, 95) as u8,
            Self::QualityFloor => {
                let rounded = value.min(100) as u8;
                let floor = if rounded < 30 { 0 } else { rounded };
                match settings.format.as_str() {
                    "jpeg" => settings.jpeg_quality_floor = floor,
                    "webp" => settings.webp_quality_floor = floor,
                    "avif" => settings.avif_quality_floor = floor,
                    _ => {}
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SuffixFeedback {
    Adjusted,
    Required,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CacheClear {
    Idle,
    Clearing,
    Cleared(usize),
    Failed(String),
}

/// What the core can do, read once at construction.
#[derive(Debug, Clone)]
struct FormatCapabilities {
    writable: Vec<String>,
    lossless: Vec<String>,
    icc_transform: bool,
}

/// A slider plus the focus handle that makes it a Tab stop with arrow-key
/// operation.
struct SliderControl {
    kind: SliderKind,
    state: Entity<SliderState>,
    focus: FocusHandle,
}

pub struct SettingsForm {
    settings: Entity<SettingsModel>,
    queue: Entity<QueueModel>,
    batch: Entity<BatchModel>,
    capabilities: FormatCapabilities,
    locale: Locale,
    syncing: bool,
    open_section: Option<Section>,
    suffix_feedback: Option<SuffixFeedback>,
    cache_clear: CacheClear,

    format: Choice,
    preset: Choice,
    overwrite: Choice,
    resize_mode: Choice,
    metadata_policy: Choice,
    avif_subsample: Choice,
    theme: Choice,

    /// In `SliderKind::ALL` order.
    sliders: Vec<SliderControl>,

    output_suffix: Entity<InputState>,
    file_name_template: Entity<InputState>,
    preset_name: Entity<InputState>,
    pdf_page_range: Entity<InputState>,
    /// In `NumberField::ALL` order.
    numbers: Vec<(NumberField, Entity<InputState>)>,

    _subscriptions: Vec<Subscription>,
}

impl SettingsForm {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let models = AppModels::global(cx).clone();
        let caps = convert::capabilities();
        let capabilities = FormatCapabilities {
            writable: caps.writable.iter().map(|f| (*f).to_string()).collect(),
            lossless: caps.lossless.iter().map(|f| (*f).to_string()).collect(),
            icc_transform: caps.color_pipeline.icc_transform,
        };
        let settings = models.settings().read(cx).settings().clone();
        let locale = Locale::current();

        let format = Choice::new(
            format_items(&capabilities.writable, models.queue().read(cx).items()),
            &settings.format,
            window,
            cx,
        );
        let preset = Choice::new(
            preset_items(&settings),
            &active_preset_id(&settings),
            window,
            cx,
        );
        let overwrite = Choice::new(overwrite_items(), settings.overwrite.as_str(), window, cx);
        let resize_mode = Choice::new(
            resize_mode_items(),
            settings.resize_mode.as_str(),
            window,
            cx,
        );
        let metadata_policy = Choice::new(
            metadata_items(),
            settings.metadata_policy.as_str(),
            window,
            cx,
        );
        let avif_subsample = Choice::new(
            avif_subsample_items(),
            settings.avif_subsample.as_str(),
            window,
            cx,
        );
        let theme = Choice::new(theme_items(), settings.theme.as_str(), window, cx);

        let sliders: Vec<SliderControl> = SliderKind::ALL
            .into_iter()
            .map(|kind| {
                let (min, max) = kind.range();
                let value = kind.value(&settings);
                SliderControl {
                    kind,
                    state: cx.new(|_| {
                        SliderState::new()
                            .min(min)
                            .max(max)
                            .step(1.)
                            .default_value(value)
                    }),
                    focus: cx.focus_handle().tab_stop(true),
                }
            })
            .collect();

        let input = |window: &mut Window,
                     cx: &mut Context<Self>,
                     value: String,
                     placeholder: SharedString| {
            cx.new(|cx| {
                InputState::new(window, cx)
                    .placeholder(placeholder)
                    .default_value(value)
            })
        };
        let output_suffix = input(
            window,
            cx,
            settings.output_suffix.clone(),
            DEFAULT_OUTPUT_SUFFIX.into(),
        );
        let file_name_template = input(
            window,
            cx,
            settings.file_name_template.clone(),
            "%name%".into(),
        );
        let preset_name = input(window, cx, String::new(), tr("workflow.preset_name"));
        let pdf_page_range = input(
            window,
            cx,
            settings.pdf_page_range.clone(),
            tr("workflow.pdf_pages_placeholder"),
        );
        let numbers: Vec<(NumberField, Entity<InputState>)> = NumberField::ALL
            .into_iter()
            .map(|field| {
                let placeholder = field.text(&Settings::default());
                (
                    field,
                    input(window, cx, field.text(&settings), placeholder.into()),
                )
            })
            .collect();

        let mut subscriptions = vec![
            cx.observe_in(models.queue(), window, |this, _, window, cx| {
                this.sync_controls(window, cx);
                cx.notify();
            }),
            cx.observe(models.batch(), |_, _, cx| cx.notify()),
            cx.observe_in(models.settings(), window, |this, _, window, cx| {
                this.sync_controls(window, cx);
                cx.notify();
            }),
        ];

        // Selects: the confirmed value is the option id.
        subscriptions.push(cx.subscribe(
            format.state(),
            |this, _, event: &SelectEvent<Vec<ChoiceItem>>, cx| {
                let SelectEvent::Confirm(value) = event;
                if let Some(format) = value.clone() {
                    this.edit(cx, |s| s.format = format);
                }
            },
        ));
        subscriptions.push(cx.subscribe(
            preset.state(),
            |this, _, event: &SelectEvent<Vec<ChoiceItem>>, cx| {
                let SelectEvent::Confirm(value) = event;
                if let Some(id) = value.clone() {
                    this.apply_preset(&id, cx);
                }
            },
        ));
        subscriptions.push(cx.subscribe(
            overwrite.state(),
            |this, _, event: &SelectEvent<Vec<ChoiceItem>>, cx| {
                let SelectEvent::Confirm(value) = event;
                if let Some(mode) = value.as_deref().and_then(OverwriteMode::parse) {
                    this.edit(cx, |s| s.overwrite = mode);
                }
            },
        ));
        subscriptions.push(cx.subscribe(
            resize_mode.state(),
            |this, _, event: &SelectEvent<Vec<ChoiceItem>>, cx| {
                let SelectEvent::Confirm(value) = event;
                if let Some(mode) = value.as_deref().and_then(ResizeMode::parse) {
                    this.set_resize_mode(mode, cx);
                }
            },
        ));
        subscriptions.push(cx.subscribe(
            metadata_policy.state(),
            |this, _, event: &SelectEvent<Vec<ChoiceItem>>, cx| {
                let SelectEvent::Confirm(value) = event;
                if let Some(policy) = value.as_deref().and_then(MetadataPolicy::parse) {
                    this.edit(cx, |s| {
                        s.metadata_policy = policy;
                        s.preserve_metadata = policy == MetadataPolicy::PreserveAll;
                    });
                }
            },
        ));
        subscriptions.push(cx.subscribe(
            avif_subsample.state(),
            |this, _, event: &SelectEvent<Vec<ChoiceItem>>, cx| {
                let SelectEvent::Confirm(value) = event;
                if let Some(subsample) = value.as_deref().and_then(AvifSubsample::parse) {
                    this.edit(cx, |s| s.avif_subsample = subsample);
                }
            },
        ));
        subscriptions.push(cx.subscribe(
            theme.state(),
            |this, _, event: &SelectEvent<Vec<ChoiceItem>>, cx| {
                let SelectEvent::Confirm(value) = event;
                if let Some(theme) = value.as_deref().and_then(ThemePreference::parse) {
                    this.edit(cx, |s| s.theme = theme);
                }
            },
        ));

        // Sliders: live value into the record; the autosave coalesces.
        for control in &sliders {
            let kind = control.kind;
            subscriptions.push(cx.subscribe(
                &control.state,
                move |this, _, event: &SliderEvent, cx| {
                    if this.syncing {
                        return;
                    }
                    let (SliderEvent::Change(value) | SliderEvent::Release(value)) = event;
                    this.apply_slider(kind, value.start(), cx);
                },
            ));
        }

        // Text inputs.
        subscriptions.push(cx.subscribe_in(
            &output_suffix,
            window,
            |this, state, event: &InputEvent, window, cx| match event {
                InputEvent::Change => {
                    let text = state.read(cx).value().to_string();
                    this.update_output_suffix_draft(&text, window, cx);
                }
                InputEvent::Blur | InputEvent::PressEnter { .. } => {
                    this.commit_output_suffix_draft(window, cx);
                }
                InputEvent::Focus => {}
            },
        ));
        subscriptions.push(cx.subscribe(
            &file_name_template,
            |this, state, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) && !this.syncing {
                    let text = state.read(cx).value().to_string();
                    this.edit(cx, |s| s.file_name_template = text);
                }
            },
        ));
        subscriptions.push(
            cx.subscribe(&pdf_page_range, |this, state, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) && !this.syncing {
                    let text: String = state
                        .read(cx)
                        .value()
                        .chars()
                        .take(MAX_PDF_PAGE_RANGE_CHARS)
                        .collect();
                    this.edit(cx, |s| s.pdf_page_range = text);
                }
            }),
        );
        subscriptions.push(cx.subscribe(&preset_name, |_, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                cx.notify();
            }
        }));
        for (field, state) in &numbers {
            let field = *field;
            subscriptions.push(cx.subscribe_in(
                state,
                window,
                move |this, state, event: &InputEvent, window, cx| {
                    if matches!(event, InputEvent::Blur | InputEvent::PressEnter { .. }) {
                        let text = state.read(cx).value().to_string();
                        this.commit_number(field, &text, cx);
                        // An explicit commit shows its result even while the
                        // field keeps focus (Enter).
                        this.reconcile_number_field(field, window, cx);
                    }
                },
            ));
        }

        Self {
            settings: models.settings().clone(),
            queue: models.queue().clone(),
            batch: models.batch().clone(),
            capabilities,
            locale,
            syncing: false,
            open_section: None,
            suffix_feedback: None,
            cache_clear: CacheClear::Idle,
            format,
            preset,
            overwrite,
            resize_mode,
            metadata_policy,
            avif_subsample,
            theme,
            sliders,
            output_suffix,
            file_name_template,
            preset_name,
            pdf_page_range,
            numbers,
            _subscriptions: subscriptions,
        }
    }

    // ---- state helpers ----

    fn snapshot(&self, cx: &App) -> Settings {
        self.settings.read(cx).settings().clone()
    }

    /// Applies an edit to the persisted record unless a batch or import is
    /// running (the Svelte shell freezes the form while busy). Lossless is
    /// cleared whenever the resulting format cannot be written losslessly,
    /// as the Svelte effect does.
    fn edit(&mut self, cx: &mut Context<Self>, apply: impl FnOnce(&mut Settings)) -> bool {
        if self.is_busy(cx) {
            return false;
        }
        let lossless = self.capabilities.lossless.clone();
        let changed = self.settings.update(cx, |settings, cx| {
            settings.update(cx, |s| {
                apply(s);
                if !lossless.contains(&s.format) {
                    s.lossless = false;
                }
            })
        });
        if changed {
            cx.notify();
        }
        changed
    }

    pub fn is_busy(&self, cx: &App) -> bool {
        self.batch.read(cx).is_active() || self.queue.read(cx).is_importing()
    }

    fn supports_lossless(&self, format: &str) -> bool {
        self.capabilities.lossless.iter().any(|f| f == format)
    }

    fn slider(&self, kind: SliderKind) -> &SliderControl {
        &self.sliders[SliderKind::ALL
            .iter()
            .position(|candidate| *candidate == kind)
            .expect("every kind has a control")]
    }

    fn number(&self, field: NumberField) -> &Entity<InputState> {
        &self
            .numbers
            .iter()
            .find(|(candidate, _)| *candidate == field)
            .expect("every field has an input")
            .1
    }

    /// The open section (one at a time).
    pub fn open_section(&self) -> Option<Section> {
        self.open_section
    }

    pub fn set_open_section(&mut self, section: Option<Section>, cx: &mut Context<Self>) {
        if self.open_section != section {
            self.open_section = section;
            cx.notify();
        }
    }

    /// Whether the record is in a state Start must refuse: target size
    /// without a lossy JPEG/WebP target, or a page range the PDF items of
    /// the batch cannot satisfy. The batch converts every queue item, so
    /// the same set is validated here.
    pub fn has_invalid_configuration(&self, cx: &App) -> bool {
        let settings = self.settings.read(cx).settings();
        self.invalid_target_size(settings, cx) || self.pdf_range_error_for_batch(cx).is_some()
    }

    fn target_formats<'a>(&'a self, settings: &'a Settings, cx: &'a App) -> Vec<&'a str> {
        let queue = self.queue.read(cx);
        if queue.is_empty() {
            return vec![settings.format.as_str()];
        }
        let mut formats = Vec::new();
        for item in queue
            .items()
            .iter()
            .filter(|item| item.is_pending_conversion())
        {
            let format = item.target_format.as_deref().unwrap_or(&settings.format);
            if !formats.contains(&format) {
                formats.push(format);
            }
        }
        formats
    }

    fn target_formats_support_size(&self, settings: &Settings, cx: &App) -> bool {
        self.target_formats(settings, cx)
            .iter()
            .all(|format| matches!(*format, "jpeg" | "webp"))
    }

    fn invalid_target_size(&self, settings: &Settings, cx: &App) -> bool {
        if !settings.target_size_enabled {
            return false;
        }
        conversion_request::has_invalid_target_size_configuration(
            settings,
            &self.target_formats(settings, cx),
        )
    }

    /// The first page-range error among the PDF items a batch would submit.
    fn pdf_range_error_for_batch(&self, cx: &App) -> Option<PdfPageRangeError> {
        let settings = self.settings.read(cx).settings();
        pdf_range_error_for_items(settings, self.queue.read(cx).items())
    }

    /// What the PDF section shows: the batch error when there are PDF
    /// items, otherwise plain syntax feedback on the text itself.
    fn pdf_range_error_for_display(&self, cx: &App) -> Option<PdfPageRangeError> {
        self.pdf_range_error_for_batch(cx).or_else(|| {
            let settings = self.settings.read(cx).settings();
            conversion_request::validate_pdf_page_range(&settings.pdf_page_range, None).err()
        })
    }

    fn has_pdf_items(&self, cx: &App) -> bool {
        self.queue
            .read(cx)
            .items()
            .iter()
            .any(imgconvert_gpui_shared::QueueItem::is_pdf)
    }

    // ---- commands (also the test surface) ----

    /// Persists `format` when the core can write it.
    pub fn set_format(&mut self, format: &str, window: &mut Window, cx: &mut Context<Self>) {
        if !self.capabilities.writable.iter().any(|f| f == format) {
            return;
        }
        let format = format.to_string();
        self.edit(cx, |s| s.format = format);
        self.sync_controls(window, cx);
    }

    /// Applies a built-in or custom preset by id; `__custom` is a no-op.
    pub fn apply_preset(&mut self, id: &str, cx: &mut Context<Self>) {
        if id == CUSTOM_PRESET_VALUE {
            return;
        }
        let snapshot = builtin_workflow_presets()
            .into_iter()
            .find(|preset| preset.id == id)
            .map(|preset| preset.snapshot)
            .or_else(|| {
                self.snapshot(cx)
                    .custom_workflow_presets
                    .iter()
                    .find(|preset| preset.id == id)
                    .map(|preset| preset.snapshot.clone())
            });
        let Some(snapshot) = snapshot else {
            return;
        };
        self.edit(cx, |s| {
            s.apply_workflow_snapshot(&snapshot);
            if s.target_size_enabled {
                s.auto_quality = false;
                s.lossless = false;
            }
        });
    }

    /// Saves the current workflow settings as a custom preset named `name`.
    /// Returns the new id, or `None` when the name is empty or the limit is
    /// reached.
    pub fn save_preset(&mut self, name: &str, cx: &mut Context<Self>) -> Option<String> {
        let settings = self.snapshot(cx);
        if !workflow_presets::can_save_custom_preset(&settings) {
            return None;
        }
        let id = workflow_presets::next_custom_preset_id(&settings.custom_workflow_presets);
        let preset = workflow_presets::create_custom_workflow_preset(&id, name, &settings)?;
        self.edit(cx, |s| s.custom_workflow_presets.push(preset))
            .then_some(id)
    }

    /// Removes a custom preset without asking. The interface asks first
    /// through an alert dialog.
    pub fn delete_preset(&mut self, id: &str, cx: &mut Context<Self>) -> bool {
        if !id.starts_with(CUSTOM_PRESET_ID_PREFIX) {
            return false;
        }
        let id = id.to_string();
        self.edit(cx, |s| {
            s.custom_workflow_presets.retain(|preset| preset.id != id);
        })
    }

    fn confirm_delete_preset(
        &mut self,
        id: String,
        name: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let form = cx.entity().downgrade();
        window.open_alert_dialog(cx, move |dialog, _, _| {
            let form = form.clone();
            let id = id.clone();
            dialog
                .title(tr_with("workflow.delete_preset_title", &[("name", &name)]))
                .description(tr("workflow.delete_preset_description"))
                .ok_text(tr("workflow.delete"))
                .ok_variant(ButtonVariant::Danger)
                .cancel_text(tr("workflow.cancel"))
                .on_ok(move |_, _, cx| {
                    let _ = form.update(cx, |form, cx| {
                        form.delete_preset(&id, cx);
                    });
                    true
                })
        });
    }

    pub fn set_resize_mode(&mut self, mode: ResizeMode, cx: &mut Context<Self>) {
        self.edit(cx, |s| {
            s.resize_mode = mode;
            if mode == ResizeMode::Percentage {
                s.resize_value = s.resize_value.min(MAX_RESIZE_PERCENT as u32);
            }
        });
    }

    /// Gives keyboard focus to a slider's wrapper (tests and future menus).
    pub fn focus_slider(&self, kind: SliderKind, window: &mut Window, cx: &mut App) {
        self.slider(kind).focus.focus(window, cx);
    }

    /// Moves a slider by keyboard or test: `raw` is the requested position.
    pub fn apply_slider(&mut self, kind: SliderKind, raw: f32, cx: &mut Context<Self>) {
        let (min, max) = kind.range();
        let value = raw.round().clamp(min, max) as u16;
        self.edit(cx, |s| kind.apply(s, value));
    }

    fn slider_key(&mut self, kind: SliderKind, event: &KeyDownEvent, cx: &mut Context<Self>) {
        let (min, max) = kind.range();
        let current = kind.value(&self.snapshot(cx));
        let page = ((max - min) / 10.).max(1.).round();
        let next = match event.keystroke.key.as_str() {
            "left" | "down" => current - 1.,
            "right" | "up" => current + 1.,
            "pagedown" => current - page,
            "pageup" => current + page,
            "home" => min,
            "end" => max,
            _ => return,
        };
        self.apply_slider(kind, next, cx);
    }

    /// Parses and clamps a numeric field like the Svelte `setNumber`:
    /// `Number("")` is 0 (then clamped to the minimum); text that is not a
    /// finite number is ignored.
    pub fn commit_number(&mut self, field: NumberField, text: &str, cx: &mut Context<Self>) {
        let trimmed = text.trim();
        let parsed = if trimmed.is_empty() {
            0.0
        } else {
            match trimmed.parse::<f64>() {
                Ok(value) if value.is_finite() => value,
                _ => return,
            }
        };
        let settings = self.snapshot(cx);
        let (min, max) = match field {
            NumberField::ResizeValue if settings.resize_mode == ResizeMode::Percentage => {
                (1, MAX_RESIZE_PERCENT)
            }
            NumberField::ResizeWidth | NumberField::ResizeHeight | NumberField::ResizeValue => {
                (1, 65_535)
            }
            NumberField::TargetSizeKib => (MIN_TARGET_SIZE_KIB, MAX_TARGET_SIZE_KIB),
            NumberField::PdfDpi => (MIN_PDF_DPI, MAX_PDF_DPI),
        };
        let value = (parsed.round() as i64).clamp(min, max);
        self.edit(cx, |s| match field {
            NumberField::ResizeWidth => s.resize_width = value as u32,
            NumberField::ResizeHeight => s.resize_height = value as u32,
            NumberField::ResizeValue => s.resize_value = value as u32,
            NumberField::TargetSizeKib => s.target_size_kib = value as u32,
            NumberField::PdfDpi => s.pdf_dpi = value as u16,
        });
    }

    /// Writes the record's value into one numeric field regardless of focus.
    fn reconcile_number_field(
        &mut self,
        field: NumberField,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let text = field.text(&self.snapshot(cx));
        let state = self.number(field).clone();
        if state.read(cx).value().as_ref() != text {
            self.syncing = true;
            state.update(cx, |state, cx| state.set_value(text, window, cx));
            self.syncing = false;
        }
    }

    pub fn set_target_size_enabled(&mut self, enabled: bool, cx: &mut Context<Self>) {
        let settings = self.snapshot(cx);
        let supported = self.target_formats_support_size(&settings, cx);
        if enabled && !supported {
            return;
        }
        self.edit(cx, |s| {
            s.target_size_enabled = enabled;
            if enabled {
                s.auto_quality = false;
                s.lossless = false;
            }
        });
    }

    fn set_output_suffix_enabled(
        &mut self,
        enabled: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.edit(cx, |s| {
            s.output_suffix_enabled = enabled;
            if enabled && s.output_suffix.trim().is_empty() {
                s.output_suffix = DEFAULT_OUTPUT_SUFFIX.to_string();
            }
        });
        self.suffix_feedback = None;
        self.sync_controls(window, cx);
    }

    /// Live normalization of the suffix field, as the Svelte input does: the
    /// field shows the normalized text, the record gets it when non-empty.
    fn update_output_suffix_draft(
        &mut self,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.syncing || self.is_busy(cx) {
            return;
        }
        let normalized = normalize_output_suffix_input(text);
        if normalized.value.is_empty() {
            self.suffix_feedback = Some(SuffixFeedback::Required);
            cx.notify();
            return;
        }
        if normalized.value != text {
            self.set_input_text(&self.output_suffix.clone(), &normalized.value, window, cx);
        }
        let value = normalized.value;
        self.edit(cx, |s| s.output_suffix = value);
        self.suffix_feedback = normalized.adjusted.then_some(SuffixFeedback::Adjusted);
        cx.notify();
    }

    /// Enter or blur: an empty suffix falls back to the default.
    fn commit_output_suffix_draft(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let typed = self.output_suffix.read(cx).value().to_string();
        if normalize_output_suffix_input(&typed).value.is_empty() {
            self.edit(cx, |s| s.output_suffix = DEFAULT_OUTPUT_SUFFIX.to_string());
            self.suffix_feedback = Some(SuffixFeedback::Required);
        }
        let stored = self.snapshot(cx).output_suffix;
        self.set_input_text(&self.output_suffix.clone(), &stored, window, cx);
        cx.notify();
    }

    fn set_input_text(
        &mut self,
        state: &Entity<InputState>,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if state.read(cx).value().as_ref() != text {
            self.syncing = true;
            let text = text.to_string();
            state.update(cx, |state, cx| state.set_value(text, window, cx));
            self.syncing = false;
        }
    }

    fn clear_result_cache(&mut self, cx: &mut Context<Self>) {
        if self.cache_clear == CacheClear::Clearing || self.is_busy(cx) {
            return;
        }
        self.cache_clear = CacheClear::Clearing;
        cx.notify();
        let cleared = cx
            .background_executor()
            .spawn(async move { result_cache::clear() });
        cx.spawn(async move |this, cx| {
            let outcome = cleared.await;
            let _ = this.update(cx, |this, cx| {
                this.cache_clear = match outcome {
                    Ok(count) => CacheClear::Cleared(count),
                    Err(error) => CacheClear::Failed(error),
                };
                cx.notify();
            });
        })
        .detach();
    }

    // ---- mirroring the record into the controls ----

    /// Mirrors the persisted record into every retained control state. Safe
    /// to call often: each control is touched only when it differs. Text
    /// fields that have focus are left alone; their commit paths reconcile
    /// them explicitly.
    pub fn sync_controls(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let settings = self.snapshot(cx);
        let locale_changed = self.locale != Locale::current();
        self.locale = Locale::current();
        self.syncing = true;

        self.format.sync(
            format_items(
                &self.capabilities.writable,
                AppModels::global(cx).queue().read(cx).items(),
            ),
            &settings.format,
            window,
            cx,
        );
        self.preset.sync(
            preset_items(&settings),
            &active_preset_id(&settings),
            window,
            cx,
        );
        self.overwrite
            .sync(overwrite_items(), settings.overwrite.as_str(), window, cx);
        self.resize_mode.sync(
            resize_mode_items(),
            settings.resize_mode.as_str(),
            window,
            cx,
        );
        self.metadata_policy.sync(
            metadata_items(),
            settings.metadata_policy.as_str(),
            window,
            cx,
        );
        self.avif_subsample.sync(
            avif_subsample_items(),
            settings.avif_subsample.as_str(),
            window,
            cx,
        );
        self.theme
            .sync(theme_items(), settings.theme.as_str(), window, cx);

        for control in &self.sliders {
            let value = control.kind.value(&settings);
            if (control.state.read(cx).value().start() - value).abs() > 0.01 {
                control
                    .state
                    .update(cx, |state, cx| state.set_value(value, window, cx));
            }
        }

        let mut inputs: Vec<(Entity<InputState>, String)> = vec![
            (self.output_suffix.clone(), settings.output_suffix.clone()),
            (
                self.file_name_template.clone(),
                settings.file_name_template.clone(),
            ),
            (self.pdf_page_range.clone(), settings.pdf_page_range.clone()),
        ];
        inputs.extend(
            self.numbers
                .iter()
                .map(|(field, state)| (state.clone(), field.text(&settings))),
        );
        for (state, value) in inputs {
            if state.read(cx).focus_handle(cx).is_focused(window) {
                continue;
            }
            if state.read(cx).value().as_ref() != value {
                state.update(cx, |state, cx| state.set_value(value, window, cx));
            }
        }
        if locale_changed {
            self.preset_name.update(cx, |state, cx| {
                state.set_placeholder(tr("workflow.preset_name"), window, cx);
            });
            self.pdf_page_range.update(cx, |state, cx| {
                state.set_placeholder(tr("workflow.pdf_pages_placeholder"), window, cx);
            });
        }
        self.syncing = false;
    }

    // ---- rendering ----

    #[allow(clippy::too_many_arguments)]
    fn switch_row(
        &self,
        id: &'static str,
        label: SharedString,
        description: Option<SharedString>,
        checked: bool,
        disabled: bool,
        on_change: impl Fn(&mut Self, bool, &mut Window, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) -> Div {
        let muted = cx.theme().muted_foreground;
        v_flex()
            .gap_1()
            .when(disabled, |this| this.opacity(0.6))
            .child(
                h_flex()
                    .justify_between()
                    .gap_3()
                    .child(div().text_sm().flex_1().min_w_0().child(label.clone()))
                    .child(
                        Switch::new(id)
                            .small()
                            .checked(checked)
                            .disabled(disabled)
                            .accessibility_label(label)
                            .on_change(cx.listener(move |this, checked: &bool, window, cx| {
                                on_change(this, *checked, window, cx);
                            })),
                    ),
            )
            .children(description.map(|text| div().text_xs().text_color(muted).child(text)))
    }

    fn labeled_value(label: SharedString, value: SharedString, cx: &App) -> Div {
        h_flex()
            .justify_between()
            .gap_3()
            .child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child(label),
            )
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(value),
            )
    }

    fn hint(text: SharedString, danger: bool, cx: &App) -> Div {
        let color = if danger {
            cx.theme().danger
        } else {
            cx.theme().muted_foreground
        };
        div().text_xs().text_color(color).child(text)
    }

    fn field_label(text: SharedString, cx: &App) -> Div {
        div()
            .text_xs()
            .text_color(cx.theme().muted_foreground)
            .child(text)
    }

    /// A labeled slider: the label row shows the value; the wrapper is a Tab
    /// stop that takes arrow, page, Home and End keys.
    fn slider_field(
        &self,
        kind: SliderKind,
        label: SharedString,
        value: SharedString,
        disabled: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        let control = self.slider(kind);
        let ring = cx.theme().ring;
        v_flex()
            .gap_1()
            .when(disabled, |this| this.opacity(0.6))
            .child(Self::labeled_value(label.clone(), value, cx))
            .child(
                // Only an enabled slider is a Tab stop and takes keys.
                div()
                    .id(kind.id())
                    .test_support()
                    .aria_label(label)
                    .rounded_md()
                    .border_1()
                    .border_color(transparent_black())
                    .when(!disabled, |this| {
                        this.track_focus(&control.focus)
                            .focus_visible(move |style| style.border_color(ring))
                            .on_key_down(cx.listener(move |this, event: &KeyDownEvent, _, cx| {
                                this.slider_key(kind, event, cx);
                            }))
                    })
                    .child(Slider::new(&control.state).disabled(disabled)),
            )
    }

    fn render_core(&self, settings: &Settings, busy: bool, cx: &mut Context<Self>) -> Div {
        let can_lossless = self.supports_lossless(&settings.format);
        let quality_enabled = settings.format != "png" && !(can_lossless && settings.lossless);
        let auto_quality_supported = matches!(settings.format.as_str(), "jpeg" | "webp")
            && quality_enabled
            && !settings.target_size_enabled;
        let title =
            if (settings.auto_quality && auto_quality_supported) || settings.target_size_enabled {
                tr("settings.quality_upper_bound")
            } else {
                tr("settings.quality")
            };
        let effective = effective_quality_for(settings, &settings.format, can_lossless);
        let quality_label: SharedString = if quality_enabled && effective > settings.quality {
            tr_with(
                "settings.quality_effective",
                &[("requested", &settings.quality), ("effective", &effective)],
            )
        } else {
            settings.quality.to_string().into()
        };
        v_flex()
            .gap_3()
            .child(
                v_flex()
                    .gap_1()
                    .child(Self::field_label(tr("settings.target_format"), cx))
                    .child(
                        Select::new(self.format.state())
                            .id("workflow-format")
                            .small()
                            .accessibility_label(tr("settings.target_format"))
                            .disabled(busy),
                    ),
            )
            .child(self.slider_field(
                SliderKind::Quality,
                title,
                quality_label,
                !quality_enabled || busy,
                cx,
            ))
    }

    fn render_sections(&self, settings: &Settings, busy: bool, cx: &mut Context<Self>) -> Div {
        let mut list = v_flex().id("settings-sections").gap_2();
        for section in Section::ALL {
            let open = self.open_section == Some(section);
            let (summary, error) = self.section_summary(section, settings, cx);
            let body = if open {
                Some(self.render_section_body(section, settings, busy, cx))
            } else {
                None
            };
            let header = self.section_header(section, summary, error, open, cx);
            list = list.child(
                v_flex()
                    .rounded_md()
                    .border_1()
                    .border_color(cx.theme().border)
                    .child(header)
                    .child(
                        Collapsible::new()
                            .open(open)
                            .motion_id(SharedString::from(format!("{}-body", section.id())))
                            .content(v_flex().px_3().pb_3().pt_1().children(body)),
                    ),
            );
        }
        div().child(list)
    }

    /// The section's toggle: a quiet full-width button with the title, the
    /// summary and an error marker that does not rely on color alone.
    fn section_header(
        &self,
        section: Section,
        summary: SharedString,
        error: bool,
        open: bool,
        cx: &mut Context<Self>,
    ) -> Button {
        let color = if error {
            cx.theme().danger
        } else {
            cx.theme().muted_foreground
        };
        let chevron = if open {
            IconName::ChevronDown
        } else {
            IconName::ChevronRight
        };
        Button::new(section.id())
            .ghost()
            .w_full()
            .tooltip(tr(section.title_key()))
            .child(
                h_flex()
                    .w_full()
                    .items_center()
                    .justify_between()
                    .gap_3()
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .child(Icon::new(chevron).xsmall())
                            .child(div().text_sm().child(tr(section.title_key()))),
                    )
                    .child(
                        h_flex()
                            .gap_1()
                            .items_center()
                            .min_w_0()
                            .text_xs()
                            .text_color(color)
                            .when(error, |this| {
                                this.child(Icon::new(IconName::TriangleAlert).xsmall())
                            })
                            .child(div().truncate().child(summary)),
                    ),
            )
            .on_click(cx.listener(move |this, _, _, cx| {
                let next = if this.open_section == Some(section) {
                    None
                } else {
                    Some(section)
                };
                this.set_open_section(next, cx);
            }))
    }

    fn section_summary(
        &self,
        section: Section,
        settings: &Settings,
        cx: &App,
    ) -> (SharedString, bool) {
        match section {
            Section::Output => {
                let concurrency = if settings.concurrency > 0 {
                    settings.concurrency.to_string()
                } else {
                    tr("settings.concurrency_auto").to_string()
                };
                let overwrite = overwrite_label(settings.overwrite);
                let naming = if settings.output_suffix_enabled {
                    settings.output_suffix.clone()
                } else {
                    settings.file_name_template.clone()
                };
                (
                    format!("{concurrency} · {overwrite} · {naming}").into(),
                    false,
                )
            }
            Section::Compression => {
                let count = self.enabled_policy_count(settings);
                (
                    tr_with("settings.enabled_count", &[("count", &count)]),
                    false,
                )
            }
            Section::Color => (
                enabled_label(
                    settings.color_management_policy == ColorManagementPolicy::ConvertToSrgb,
                ),
                false,
            ),
            Section::Cache => (enabled_label(settings.result_cache), false),
            Section::FormatParameters => (
                match settings.format.as_str() {
                    "jpeg" if settings.jpeg_progressive => tr("settings.jpeg_progressive_mode"),
                    "jpeg" => tr("settings.jpeg_baseline_mode"),
                    "png" => format!("oxipng {}", settings.png_oxipng_level).into(),
                    "webp" => {
                        format!("{} {}", tr("settings.webp_method"), settings.webp_method).into()
                    }
                    "avif" => {
                        format!("{} {}", tr("settings.avif_speed"), settings.avif_speed).into()
                    }
                    _ => SharedString::default(),
                },
                false,
            ),
            Section::Presets => (
                workflow_presets::matching_workflow_preset_id(settings)
                    .and_then(|id| preset_label(&id, settings))
                    .unwrap_or_else(|| tr("workflow.custom_settings")),
                false,
            ),
            Section::Pdf => {
                let error = self.pdf_range_error_for_display(cx).is_some();
                let summary = if settings.pdf_page_range.trim().is_empty() {
                    tr("workflow.pdf_all_pages")
                } else {
                    tr("workflow.pdf_selected_pages")
                };
                (summary, error)
            }
            Section::Resize => (resize_mode_label(settings.resize_mode), false),
            Section::TargetSize => {
                let invalid = self.invalid_target_size(settings, cx);
                let summary = if settings.target_size_enabled {
                    tr_with(
                        "workflow.target_summary",
                        &[("kib", &settings.target_size_kib)],
                    )
                } else {
                    tr("settings.disabled")
                };
                (summary, invalid)
            }
            Section::Metadata => (metadata_label(settings.metadata_policy), false),
            Section::Appearance => {
                let theme = theme_label(settings.theme);
                let summary = if settings.reduce_motion {
                    format!("{theme} · {}", tr("settings.reduce_motion_label")).into()
                } else {
                    theme
                };
                (summary, false)
            }
        }
    }

    fn enabled_policy_count(&self, settings: &Settings) -> usize {
        let can_lossless = self.supports_lossless(&settings.format);
        let quality_enabled = settings.format != "png" && !(can_lossless && settings.lossless);
        let auto_quality_supported = matches!(settings.format.as_str(), "jpeg" | "webp")
            && quality_enabled
            && !settings.target_size_enabled;
        [
            settings.lossless,
            settings.skip_if_larger,
            settings.multi_candidate,
            settings.auto_quality && auto_quality_supported,
            settings.generation_loss_protection,
        ]
        .into_iter()
        .filter(|on| *on)
        .count()
    }

    fn render_section_body(
        &self,
        section: Section,
        settings: &Settings,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        match section {
            Section::Output => self.render_output(settings, busy, cx),
            Section::Compression => self.render_compression(settings, busy, cx),
            Section::Color => self.render_color(settings, busy, cx),
            Section::Cache => self.render_cache(settings, busy, cx),
            Section::FormatParameters => self.render_format_parameters(settings, busy, cx),
            Section::Presets => self.render_presets(settings, busy, cx),
            Section::Pdf => self.render_pdf(busy, cx),
            Section::Resize => self.render_resize(settings, busy, cx),
            Section::TargetSize => self.render_target_size(settings, busy, cx),
            Section::Metadata => self.render_metadata(settings, busy, cx),
            Section::Appearance => self.render_appearance(settings, busy, cx),
        }
    }

    fn text_field(
        &self,
        id: &'static str,
        label: SharedString,
        state: &Entity<InputState>,
        busy: bool,
        cx: &App,
    ) -> Div {
        v_flex()
            .gap_1()
            .flex_1()
            .min_w_0()
            .child(Self::field_label(label.clone(), cx))
            .child(
                Input::new(state)
                    .id(id)
                    .small()
                    .aria_label(label)
                    .disabled(busy),
            )
    }

    fn render_output(&self, settings: &Settings, busy: bool, cx: &mut Context<Self>) -> Div {
        let concurrency_value: SharedString = if settings.concurrency > 0 {
            settings.concurrency.to_string().into()
        } else {
            tr("settings.concurrency_auto")
        };
        let suffix_feedback = self.suffix_feedback;
        v_flex()
            .gap_4()
            .child(self.slider_field(
                SliderKind::Concurrency,
                tr("settings.concurrency"),
                concurrency_value,
                busy,
                cx,
            ))
            .child(
                v_flex()
                    .gap_1()
                    .child(Self::field_label(tr("settings.existing_files"), cx))
                    .child(
                        Select::new(self.overwrite.state())
                            .id("settings-overwrite")
                            .small()
                            .accessibility_label(tr("settings.existing_files"))
                            .disabled(busy),
                    ),
            )
            .child(
                v_flex()
                    .gap_2()
                    .child(self.switch_row(
                        "switch-output-suffix",
                        tr("settings.add_output_suffix"),
                        None,
                        settings.output_suffix_enabled,
                        busy,
                        |this, checked, window, cx| {
                            this.set_output_suffix_enabled(checked, window, cx);
                        },
                        cx,
                    ))
                    .when(settings.output_suffix_enabled, |this| {
                        this.child(
                            self.text_field(
                                "settings-output-suffix",
                                tr("settings.output_suffix"),
                                &self.output_suffix,
                                busy,
                                cx,
                            )
                            .child(Self::hint(tr("settings.output_suffix_hint"), false, cx))
                            .children(suffix_feedback.map(
                                |feedback| {
                                    Self::hint(
                                        match feedback {
                                            SuffixFeedback::Adjusted => {
                                                tr("settings.output_suffix_adjusted")
                                            }
                                            SuffixFeedback::Required => {
                                                tr("settings.output_suffix_required")
                                            }
                                        },
                                        feedback == SuffixFeedback::Required,
                                        cx,
                                    )
                                },
                            )),
                        )
                    })
                    .when(!settings.output_suffix_enabled, |this| {
                        this.child(Self::hint(
                            tr("settings.suffix_disabled_collision_hint"),
                            false,
                            cx,
                        ))
                        .child(
                            self.text_field(
                                "settings-file-name-template",
                                tr("settings.file_name_template"),
                                &self.file_name_template,
                                busy,
                                cx,
                            )
                            .child(Self::hint(
                                tr("settings.file_name_template_hint"),
                                false,
                                cx,
                            )),
                        )
                    }),
            )
    }

    fn render_compression(&self, settings: &Settings, busy: bool, cx: &mut Context<Self>) -> Div {
        let can_lossless = self.supports_lossless(&settings.format);
        let resize_active = settings.resize_mode != ResizeMode::None;
        let quality_enabled = settings.format != "png" && !(can_lossless && settings.lossless);
        let auto_quality_supported = matches!(settings.format.as_str(), "jpeg" | "webp")
            && quality_enabled
            && !settings.target_size_enabled;
        v_flex()
            .gap_3()
            .child(self.switch_row(
                "switch-lossless",
                tr("settings.lossless_label"),
                Some(tr("settings.lossless_description")),
                settings.lossless,
                !can_lossless || settings.target_size_enabled || busy,
                |this, checked, _, cx| {
                    this.edit(cx, |s| s.lossless = checked);
                },
                cx,
            ))
            .child(self.switch_row(
                "switch-skip-if-larger",
                tr("settings.skip_larger_label"),
                Some(tr("settings.skip_larger_description")),
                settings.skip_if_larger,
                busy || resize_active,
                |this, checked, _, cx| {
                    this.edit(cx, |s| s.skip_if_larger = checked);
                },
                cx,
            ))
            .child(self.switch_row(
                "switch-multi-candidate",
                tr("settings.multi_candidate_label"),
                Some(tr("settings.multi_candidate_description")),
                settings.multi_candidate,
                busy,
                |this, checked, _, cx| {
                    this.edit(cx, |s| s.multi_candidate = checked);
                },
                cx,
            ))
            .child(self.switch_row(
                "switch-auto-quality",
                tr("settings.auto_quality_label"),
                Some(tr("settings.auto_quality_description")),
                settings.auto_quality && auto_quality_supported,
                !auto_quality_supported || busy,
                |this, checked, _, cx| {
                    this.edit(cx, |s| s.auto_quality = checked);
                },
                cx,
            ))
            .child(self.switch_row(
                "switch-generation-loss-protection",
                tr("settings.generation_protection_label"),
                Some(tr("settings.generation_protection_description")),
                settings.generation_loss_protection,
                busy || resize_active,
                |this, checked, _, cx| {
                    this.edit(cx, |s| s.generation_loss_protection = checked);
                },
                cx,
            ))
            .when(resize_active, |this| {
                this.child(Self::hint(
                    tr("workflow.compression_policy_disabled"),
                    false,
                    cx,
                ))
            })
    }

    fn render_color(&self, settings: &Settings, busy: bool, cx: &mut Context<Self>) -> Div {
        self.switch_row(
            "switch-convert-to-srgb",
            tr("settings.convert_to_srgb_label"),
            Some(tr("settings.convert_to_srgb_description")),
            settings.color_management_policy == ColorManagementPolicy::ConvertToSrgb,
            busy || !self.capabilities.icc_transform,
            |this, checked, _, cx| {
                this.edit(cx, |s| {
                    s.color_management_policy = if checked {
                        ColorManagementPolicy::ConvertToSrgb
                    } else {
                        ColorManagementPolicy::Preserve
                    };
                });
            },
            cx,
        )
    }

    fn render_cache(&self, settings: &Settings, busy: bool, cx: &mut Context<Self>) -> Div {
        let clearing = self.cache_clear == CacheClear::Clearing;
        let result = match &self.cache_clear {
            CacheClear::Cleared(count) => Some(Self::hint(
                tr_with("settings.result_cache_cleared", &[("count", count)]),
                false,
                cx,
            )),
            CacheClear::Failed(_detail) => Some(Self::hint(
                tr("settings.clear_result_cache_failed_generic"),
                true,
                cx,
            )),
            CacheClear::Idle | CacheClear::Clearing => None,
        };
        v_flex()
            .gap_3()
            .child(self.switch_row(
                "switch-result-cache",
                tr("settings.result_cache_label"),
                Some(tr("settings.result_cache_description")),
                settings.result_cache,
                busy,
                |this, checked, _, cx| {
                    this.edit(cx, |s| s.result_cache = checked);
                },
                cx,
            ))
            .child(
                h_flex().gap_2().flex_wrap().child(
                    Button::new("settings-clear-cache")
                        .outline()
                        .small()
                        .label(if clearing {
                            tr("settings.clearing_result_cache")
                        } else {
                            tr("settings.clear_result_cache")
                        })
                        .disabled(busy || clearing)
                        .loading(clearing)
                        .on_click(cx.listener(|this, _, _, cx| this.clear_result_cache(cx))),
                ),
            )
            .children(result)
    }

    fn render_format_parameters(
        &self,
        settings: &Settings,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        let can_lossless = self.supports_lossless(&settings.format);
        let quality_enabled = settings.format != "png" && !(can_lossless && settings.lossless);
        let auto_quality_supported = matches!(settings.format.as_str(), "jpeg" | "webp")
            && quality_enabled
            && !settings.target_size_enabled;
        let has_quality_floor = matches!(settings.format.as_str(), "jpeg" | "webp" | "avif");
        let floor = quality_floor_for(settings, &settings.format);
        let floor_label: SharedString = if floor >= 30 {
            floor.to_string().into()
        } else {
            tr("settings.quality_floor_off")
        };
        let mut body = v_flex().gap_3();
        match settings.format.as_str() {
            "jpeg" => {
                body = body
                    .child(self.switch_row(
                        "switch-jpeg-progressive",
                        tr("settings.progressive_jpeg"),
                        None,
                        settings.jpeg_progressive,
                        busy,
                        |this, checked, _, cx| {
                            this.edit(cx, |s| s.jpeg_progressive = checked);
                        },
                        cx,
                    ))
                    .child(self.switch_row(
                        "switch-jpeg-trellis",
                        tr("settings.trellis_scans"),
                        None,
                        settings.jpeg_trellis,
                        busy,
                        |this, checked, _, cx| {
                            this.edit(cx, |s| s.jpeg_trellis = checked);
                        },
                        cx,
                    ));
            }
            "png" => {
                body = body
                    .child(self.slider_field(
                        SliderKind::PngOxipngLevel,
                        tr("settings.png_optimization_level"),
                        settings.png_oxipng_level.to_string().into(),
                        busy,
                        cx,
                    ))
                    .child(self.switch_row(
                        "switch-png-lossy-quantize",
                        tr("settings.experimental_quantize"),
                        None,
                        settings.png_lossy_quantize,
                        busy,
                        |this, checked, _, cx| {
                            this.edit(cx, |s| s.png_lossy_quantize = checked);
                        },
                        cx,
                    ))
                    .when(settings.png_lossy_quantize, |this| {
                        this.child(self.slider_field(
                            SliderKind::PngQuantColors,
                            tr("settings.color_count"),
                            settings.png_quant_colors.to_string().into(),
                            busy,
                            cx,
                        ))
                    });
            }
            "webp" => {
                body = body
                    .child(self.slider_field(
                        SliderKind::WebpMethod,
                        tr("settings.webp_method"),
                        settings.webp_method.to_string().into(),
                        busy,
                        cx,
                    ))
                    .when(can_lossless && settings.lossless, |this| {
                        let value: SharedString = if settings.webp_near_lossless == 100 {
                            tr("settings.near_lossless_off")
                        } else {
                            settings.webp_near_lossless.to_string().into()
                        };
                        this.child(self.slider_field(
                            SliderKind::WebpNearLossless,
                            tr("settings.near_lossless"),
                            value,
                            busy,
                            cx,
                        ))
                    })
                    .child(self.switch_row(
                        "switch-webp-sharp-yuv",
                        tr("settings.sharp_yuv"),
                        None,
                        settings.webp_sharp_yuv,
                        busy,
                        |this, checked, _, cx| {
                            this.edit(cx, |s| s.webp_sharp_yuv = checked);
                        },
                        cx,
                    ));
            }
            "avif" => {
                body = body
                    .child(self.slider_field(
                        SliderKind::AvifSpeed,
                        tr("settings.avif_speed"),
                        settings.avif_speed.to_string().into(),
                        busy,
                        cx,
                    ))
                    .child(
                        v_flex()
                            .gap_1()
                            .child(Self::field_label(
                                tr("settings.avif_chroma_subsampling"),
                                cx,
                            ))
                            .child(
                                Select::new(self.avif_subsample.state())
                                    .id("settings-avif-subsample")
                                    .small()
                                    .accessibility_label(tr("settings.avif_chroma_subsampling"))
                                    .disabled(busy),
                            ),
                    );
            }
            _ => {}
        }
        body.when(auto_quality_supported && settings.auto_quality, |this| {
            this.child(self.slider_field(
                SliderKind::AutoQualityScore,
                tr("settings.target_score"),
                settings.auto_quality_score.to_string().into(),
                busy,
                cx,
            ))
        })
        .when(has_quality_floor, |this| {
            this.child(self.slider_field(
                SliderKind::QualityFloor,
                tr("settings.minimum_quality"),
                floor_label,
                !quality_enabled || busy,
                cx,
            ))
        })
    }

    fn render_presets(&self, settings: &Settings, busy: bool, cx: &mut Context<Self>) -> Div {
        let active = workflow_presets::matching_workflow_preset_id(settings);
        let description = active
            .as_deref()
            .and_then(|id| {
                builtin_workflow_presets()
                    .into_iter()
                    .find(|preset| preset.id == id)
            })
            .map(|preset| tr(preset.description_key));
        let can_save = workflow_presets::can_save_custom_preset(settings);
        let name_text = self.preset_name.read(cx).value().to_string();
        let name_valid = workflow_presets::normalize_preset_name(&name_text).is_some();
        v_flex()
            .gap_3()
            .child(
                v_flex()
                    .gap_1()
                    .child(
                        Select::new(self.preset.state())
                            .id("workflow-preset")
                            .small()
                            .accessibility_label(tr("workflow.preset"))
                            .disabled(busy),
                    )
                    .children(description.map(|text| Self::hint(text, false, cx))),
            )
            .child(
                v_flex()
                    .gap_1()
                    .child(
                        h_flex()
                            .gap_2()
                            .items_end()
                            .child(self.text_field(
                                "workflow-preset-name",
                                tr("workflow.preset_name"),
                                &self.preset_name,
                                busy || !can_save,
                                cx,
                            ))
                            .child(
                                Button::new("workflow-save-preset")
                                    .outline()
                                    .small()
                                    .label(tr("workflow.save_preset"))
                                    .disabled(busy || !can_save || !name_valid)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        let name = this.preset_name.read(cx).value().to_string();
                                        if this.save_preset(&name, cx).is_some() {
                                            this.set_input_text(
                                                &this.preset_name.clone(),
                                                "",
                                                window,
                                                cx,
                                            );
                                        }
                                    })),
                            ),
                    )
                    .child(Self::hint(
                        tr_with("workflow.preset_limit", &[("count", &MAX_CUSTOM_PRESETS)]),
                        false,
                        cx,
                    )),
            )
            .when(!settings.custom_workflow_presets.is_empty(), |this| {
                this.child(
                    v_flex()
                        .gap_1()
                        .children(settings.custom_workflow_presets.iter().map(|preset| {
                            let id = preset.id.clone();
                            let name = preset.name.clone();
                            let delete_label =
                                tr_with("workflow.delete_preset_named", &[("name", &name)]);
                            h_flex()
                                .id(SharedString::from(format!("preset-row:{}", preset.id)))
                                .justify_between()
                                .items_center()
                                .gap_2()
                                .pl_2()
                                .rounded_md()
                                .border_1()
                                .border_color(cx.theme().border)
                                .child(
                                    div()
                                        .text_xs()
                                        .truncate()
                                        .flex_1()
                                        .min_w_0()
                                        .child(name.clone()),
                                )
                                .child(
                                    Button::new(SharedString::from(format!(
                                        "preset-delete:{}",
                                        preset.id
                                    )))
                                    .ghost()
                                    .small()
                                    .label(tr("workflow.delete"))
                                    .tooltip(delete_label)
                                    .disabled(busy)
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.confirm_delete_preset(
                                            id.clone(),
                                            name.clone(),
                                            window,
                                            cx,
                                        );
                                    })),
                                )
                        })),
                )
            })
    }

    fn render_pdf(&self, busy: bool, cx: &mut Context<Self>) -> Div {
        let error = self.pdf_range_error_for_display(cx);
        let hint = match &error {
            Some(error) => pdf_error_text(error),
            None => tr("workflow.pdf_pages_hint"),
        };
        let dpi_hint = if self.has_pdf_items(cx) {
            tr("workflow.pdf_dpi_hint_active")
        } else {
            tr("workflow.pdf_dpi_hint")
        };
        v_flex()
            .gap_3()
            .child(
                self.text_field(
                    "workflow-pdf-page-range",
                    tr("workflow.pdf_pages"),
                    &self.pdf_page_range,
                    busy,
                    cx,
                )
                .child(Self::hint(hint, error.is_some(), cx)),
            )
            .child(
                self.text_field(
                    "workflow-pdf-dpi",
                    tr("workflow.pdf_dpi"),
                    self.number(NumberField::PdfDpi),
                    busy,
                    cx,
                )
                .child(Self::hint(dpi_hint, false, cx)),
            )
    }

    fn render_resize(&self, settings: &Settings, busy: bool, cx: &mut Context<Self>) -> Div {
        let mode = settings.resize_mode;
        let width = || {
            self.text_field(
                "workflow-resize-width",
                tr("workflow.width"),
                self.number(NumberField::ResizeWidth),
                busy,
                cx,
            )
        };
        let height = || {
            self.text_field(
                "workflow-resize-height",
                tr("workflow.height"),
                self.number(NumberField::ResizeHeight),
                busy,
                cx,
            )
        };
        let value = |label: SharedString| {
            self.text_field(
                "workflow-resize-value",
                label,
                self.number(NumberField::ResizeValue),
                busy,
                cx,
            )
        };
        v_flex()
            .gap_3()
            .child(
                v_flex()
                    .gap_1()
                    .child(Self::field_label(tr("workflow.resize_mode"), cx))
                    .child(
                        Select::new(self.resize_mode.state())
                            .id("workflow-resize-mode")
                            .small()
                            .accessibility_label(tr("workflow.resize_mode"))
                            .disabled(busy),
                    ),
            )
            .when(mode == ResizeMode::Fit, |this| {
                this.child(h_flex().gap_2().child(width()).child(height()))
            })
            .when(mode == ResizeMode::Width, |this| this.child(width()))
            .when(mode == ResizeMode::Height, |this| this.child(height()))
            .when(mode == ResizeMode::LongestEdge, |this| {
                this.child(value(tr("workflow.size")))
            })
            .when(mode == ResizeMode::Percentage, |this| {
                this.child(value(tr("workflow.percentage")))
            })
            .when(mode != ResizeMode::None, |this| {
                this.child(self.switch_row(
                    "switch-resize-allow-upscale",
                    tr("workflow.allow_upscale"),
                    None,
                    settings.resize_allow_upscale,
                    busy,
                    |this, checked, _, cx| {
                        this.edit(cx, |s| s.resize_allow_upscale = checked);
                    },
                    cx,
                ))
                .child(Self::hint(
                    tr("workflow.compression_policy_disabled"),
                    false,
                    cx,
                ))
            })
    }

    fn render_target_size(&self, settings: &Settings, busy: bool, cx: &mut Context<Self>) -> Div {
        let supported = self.target_formats_support_size(settings, cx);
        let invalid = self.invalid_target_size(settings, cx);
        v_flex()
            .gap_3()
            .child(self.switch_row(
                "switch-target-size",
                tr("workflow.target_enable"),
                None,
                settings.target_size_enabled,
                busy || (!supported && !settings.target_size_enabled),
                |this, checked, _, cx| this.set_target_size_enabled(checked, cx),
                cx,
            ))
            .when(settings.target_size_enabled, |this| {
                this.child(self.text_field(
                    "workflow-target-size-kib",
                    tr("workflow.target_kib"),
                    self.number(NumberField::TargetSizeKib),
                    busy,
                    cx,
                ))
            })
            .child(Self::hint(
                if invalid {
                    tr("workflow.target_unsupported")
                } else {
                    tr("workflow.target_hint")
                },
                invalid,
                cx,
            ))
    }

    fn render_metadata(&self, settings: &Settings, busy: bool, cx: &mut Context<Self>) -> Div {
        v_flex()
            .gap_1()
            .child(Self::field_label(tr("workflow.metadata_policy"), cx))
            .child(
                Select::new(self.metadata_policy.state())
                    .id("workflow-metadata-policy")
                    .small()
                    .accessibility_label(tr("workflow.metadata_policy"))
                    .disabled(busy),
            )
            .child(Self::hint(
                metadata_description(settings.metadata_policy),
                false,
                cx,
            ))
    }

    fn render_appearance(&self, settings: &Settings, busy: bool, cx: &mut Context<Self>) -> Div {
        v_flex()
            .gap_3()
            .child(
                v_flex()
                    .gap_1()
                    .child(Self::field_label(tr("settings.theme"), cx))
                    .child(
                        Select::new(self.theme.state())
                            .id("workflow-theme")
                            .small()
                            .accessibility_label(tr("settings.theme"))
                            .disabled(busy),
                    ),
            )
            .child(self.switch_row(
                "switch-reduce-motion",
                tr("settings.reduce_motion_label"),
                Some(tr("settings.reduce_motion_description")),
                settings.reduce_motion,
                busy,
                |this, on, _, cx| {
                    this.edit(cx, |s| s.reduce_motion = on);
                },
                cx,
            ))
    }
}

impl Render for SettingsForm {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Locale is global and can change without a settings notification.
        if self.locale != Locale::current() {
            self.sync_controls(window, cx);
        }
        let settings = self.snapshot(cx);
        let busy = self.is_busy(cx);
        v_flex()
            .id("settings-form")
            .test_support()
            .gap_4()
            .child(
                div()
                    .text_xs()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(cx.theme().muted_foreground)
                    .child(tr("settings.core_section")),
            )
            .child(self.render_core(&settings, busy, cx))
            .child(self.render_sections(&settings, busy, cx))
    }
}

// ---- option lists and labels ----

const RESIZE_MODES: [ResizeMode; 6] = [
    ResizeMode::None,
    ResizeMode::Fit,
    ResizeMode::Width,
    ResizeMode::Height,
    ResizeMode::LongestEdge,
    ResizeMode::Percentage,
];
const METADATA_POLICIES: [MetadataPolicy; 3] = [
    MetadataPolicy::StripAll,
    MetadataPolicy::ColorOnly,
    MetadataPolicy::PreserveAll,
];

fn format_items(
    formats: &[String],
    items: &[imgconvert_gpui_shared::QueueItem],
) -> Vec<ChoiceItem> {
    formats
        .iter()
        .map(|format| {
            let label = if items
                .iter()
                .any(|item| item.source_format_hint() == Some(format.as_str()))
            {
                tr_with(
                    "queue.source_format",
                    &[("format", &format.to_ascii_uppercase())],
                )
            } else {
                format.to_ascii_uppercase().into()
            };
            ChoiceItem::new(format.clone(), label)
        })
        .collect()
}

fn overwrite_label(mode: OverwriteMode) -> SharedString {
    match mode {
        OverwriteMode::Ask => tr("settings.overwrite_ask"),
        OverwriteMode::Skip => tr("settings.overwrite_skip"),
        OverwriteMode::Overwrite => tr("settings.overwrite_overwrite"),
    }
}

fn overwrite_items() -> Vec<ChoiceItem> {
    [
        OverwriteMode::Ask,
        OverwriteMode::Skip,
        OverwriteMode::Overwrite,
    ]
    .into_iter()
    .map(|mode| ChoiceItem::new(mode.as_str(), overwrite_label(mode)))
    .collect()
}

fn resize_mode_label(mode: ResizeMode) -> SharedString {
    tr(match mode {
        ResizeMode::None => "workflow.resize_modes.none",
        ResizeMode::Fit => "workflow.resize_modes.fit",
        ResizeMode::Width => "workflow.resize_modes.width",
        ResizeMode::Height => "workflow.resize_modes.height",
        ResizeMode::LongestEdge => "workflow.resize_modes.longest_edge",
        ResizeMode::Percentage => "workflow.resize_modes.percentage",
    })
}

fn resize_mode_items() -> Vec<ChoiceItem> {
    RESIZE_MODES
        .into_iter()
        .map(|mode| ChoiceItem::new(mode.as_str(), resize_mode_label(mode)))
        .collect()
}

fn metadata_label(policy: MetadataPolicy) -> SharedString {
    tr(match policy {
        MetadataPolicy::StripAll => "workflow.metadata.strip_all",
        MetadataPolicy::ColorOnly => "workflow.metadata.color_only",
        MetadataPolicy::PreserveAll => "workflow.metadata.preserve_all",
    })
}

fn metadata_description(policy: MetadataPolicy) -> SharedString {
    tr(match policy {
        MetadataPolicy::StripAll => "workflow.metadata.strip_all_description",
        MetadataPolicy::ColorOnly => "workflow.metadata.color_only_description",
        MetadataPolicy::PreserveAll => "workflow.metadata.preserve_all_description",
    })
}

fn metadata_items() -> Vec<ChoiceItem> {
    METADATA_POLICIES
        .into_iter()
        .map(|policy| ChoiceItem::new(policy.as_str(), metadata_label(policy)))
        .collect()
}

const THEME_PREFERENCES: [ThemePreference; 3] = [
    ThemePreference::System,
    ThemePreference::Light,
    ThemePreference::Dark,
];

fn theme_label(theme: ThemePreference) -> SharedString {
    tr(match theme {
        ThemePreference::System => "settings.theme_system",
        ThemePreference::Light => "settings.theme_light",
        ThemePreference::Dark => "settings.theme_dark",
    })
}

fn theme_items() -> Vec<ChoiceItem> {
    THEME_PREFERENCES
        .into_iter()
        .map(|theme| ChoiceItem::new(theme.as_str(), theme_label(theme)))
        .collect()
}

fn avif_subsample_items() -> Vec<ChoiceItem> {
    vec![
        ChoiceItem::new("yuv444", "4:4:4"),
        ChoiceItem::new("yuv420", "4:2:0"),
    ]
}

fn enabled_label(on: bool) -> SharedString {
    if on {
        tr("settings.enabled")
    } else {
        tr("settings.disabled")
    }
}

fn active_preset_id(settings: &Settings) -> String {
    workflow_presets::matching_workflow_preset_id(settings)
        .unwrap_or_else(|| CUSTOM_PRESET_VALUE.to_string())
}

/// Options of the preset select: custom sentinel, built-ins, then the saved
/// presets (by id, so equal names stay distinct).
fn preset_items(settings: &Settings) -> Vec<ChoiceItem> {
    let mut items = vec![ChoiceItem::new(
        CUSTOM_PRESET_VALUE,
        tr("workflow.custom_settings"),
    )];
    for preset in builtin_workflow_presets() {
        items.push(ChoiceItem::new(preset.id, tr(preset.label_key)));
    }
    for preset in &settings.custom_workflow_presets {
        items.push(ChoiceItem::new(preset.id.clone(), preset.name.clone()));
    }
    items
}

fn preset_label(id: &str, settings: &Settings) -> Option<SharedString> {
    builtin_workflow_presets()
        .into_iter()
        .find(|preset| preset.id == id)
        .map(|preset| tr(preset.label_key))
        .or_else(|| {
            settings
                .custom_workflow_presets
                .iter()
                .find(|preset| preset.id == id)
                .map(|preset| SharedString::from(preset.name.clone()))
        })
}

fn pdf_error_text(error: &PdfPageRangeError) -> SharedString {
    match error {
        PdfPageRangeError::SelectionRequired { limit } => {
            tr_with("workflow.pdf_range_required", &[("count", limit)])
        }
        PdfPageRangeError::TooLong => tr("workflow.pdf_range_too_long"),
        PdfPageRangeError::OutOfBounds { page_count } => {
            tr_with("workflow.pdf_range_out_of_bounds", &[("count", page_count)])
        }
        PdfPageRangeError::TooManyPages { limit } => {
            tr_with("workflow.pdf_too_many_pages", &[("count", limit)])
        }
        // `Invalid` and any variant a newer backend adds.
        _ => tr("workflow.pdf_range_invalid"),
    }
}

fn pdf_range_error_for_items(
    settings: &Settings,
    items: &[imgconvert_gpui_shared::QueueItem],
) -> Option<PdfPageRangeError> {
    items
        .iter()
        .filter(|item| item.is_pdf() && item.is_pending_conversion())
        .find_map(|item| {
            conversion_request::validate_pdf_page_range(&settings.pdf_page_range, item.page_count)
                .err()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completed_pdf_does_not_limit_the_next_batch_page_range() {
        let mut queue = QueueModel::default();
        queue.add_files(
            [("old", 1), ("new", 2)]
                .into_iter()
                .map(|(key, pages)| imgconvert_backend::import::ImportScanFile {
                    key: key.into(),
                    path: format!("/fixture/{key}.pdf"),
                    relative_dir: None,
                    metadata: Some(imgconvert_backend::import::ImportImageMetadata {
                        format: "pdf".into(),
                        width: 150,
                        height: 150,
                        dpi_x: None,
                        dpi_y: None,
                        page_count: Some(pages),
                    }),
                })
                .collect(),
        );
        let mut items = queue.items().to_vec();
        let mut settings = Settings::default();
        settings.pdf_page_range = "2".into();
        assert!(pdf_range_error_for_items(&settings, &items).is_some());
        items[0].status = imgconvert_gpui_shared::ItemStatus::Done {
            in_size: 1,
            out_size: 1,
            comparable: false,
        };
        assert!(pdf_range_error_for_items(&settings, &items).is_none());
        items[0].status = imgconvert_gpui_shared::ItemStatus::Pending;
        assert!(pdf_range_error_for_items(&settings, &items).is_some());
    }
}
