// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The product theme layer ("Clear Glass 2.0", design decision of
//! 2026-10-22: two glass panels on a soft backdrop and a floating action
//! capsule; light "Clear" and dark "Obsidian" palettes).
//!
//! Three things live here and nowhere else:
//!
//! - the two bundled Kit theme files (`themes/imgconvert-glass.json`, light
//!   and dark) that give every Kit component its colors, radius and shadow;
//! - the application-owned [`GlassTokens`] Kit has no role for: the blurred
//!   backdrop, the translucent panel surface with its stroke and specular
//!   highlight, the floating action capsule, the quiet chip and well fills
//!   inside panels and the primary button's glow;
//! - the bridge from the persisted `theme` / `reduceMotion` settings to Kit
//!   ([`install`], [`apply`]).
//!
//! Raw color values are allowed in this module and in the theme file only;
//! feature code reads `cx.theme()` and [`ActiveGlass::glass`].

use std::collections::HashMap;
use std::sync::Arc;

use gpui_kit::component::{ActiveTheme as _, Theme, ThemeMode, ThemeRegistry, ThemeToken};
use gpui_kit::{
    App, BoxShadow, Global, Hsla, Pixels, RenderImage, Rgba, Styled, Subscription, Window,
    WindowAppearance, linear_color_stop, linear_gradient, px, rgba,
};
use image::{Frame, RgbaImage};
use imgconvert_backend::settings::Theme as ThemePreference;

use crate::AppModels;

/// The bundled theme set; both configs are registered under these names.
const THEME_SET: &str = include_str!("../themes/imgconvert-glass.json");
pub const LIGHT_THEME_NAME: &str = "ImgConvert Glass Light";
pub const DARK_THEME_NAME: &str = "ImgConvert Glass Dark";

/// Keeps the settings observer alive and caches the rendered backdrops so a
/// mode switch does not upload a new texture every time.
struct ThemeSync {
    _subscription: Subscription,
    backdrops: HashMap<ThemeMode, Arc<RenderImage>>,
}

impl Global for ThemeSync {}

/// Registers the bundled themes, applies the persisted preference and keeps
/// following the settings record. Call after `gpui_kit::init` and the
/// services' init; a second call only re-applies.
pub fn install(cx: &mut App) {
    if !cx.has_global::<ThemeSync>() {
        ThemeRegistry::global_mut(cx)
            .load_themes_from_str(THEME_SET)
            .expect("the bundled theme file parses");
        let (light, dark) = {
            let themes = ThemeRegistry::global(cx).themes();
            (
                themes
                    .get(LIGHT_THEME_NAME)
                    .cloned()
                    .expect("light theme registered"),
                themes
                    .get(DARK_THEME_NAME)
                    .cloned()
                    .expect("dark theme registered"),
            )
        };
        Theme::update(cx, |theme| {
            theme.light_theme = light;
            theme.dark_theme = dark;
        });
        let settings = AppModels::global(cx).settings().clone();
        let subscription = cx.observe(&settings, |_, cx| apply(None, cx));
        cx.set_global(ThemeSync {
            _subscription: subscription,
            backdrops: HashMap::new(),
        });
        // Load the bundled config over Kit's default even when the mode is
        // unchanged; `apply` only switches when something differs.
        let mode = resolved_mode(None, cx);
        Theme::change(mode, None, cx);
        apply_mode_tokens(mode, cx);
    }
    apply(None, cx);
}

/// Brings Kit's mode, the reduced-motion flag and the glass tokens in line
/// with the settings record and the system appearance. Cheap when nothing
/// changed, so it may run on every settings notification.
pub fn apply(window: Option<&mut Window>, cx: &mut App) {
    if !cx.has_global::<ThemeSync>() {
        return;
    }
    let mode = resolved_mode(window.as_deref(), cx);
    if cx.theme().mode != mode || cx.theme().theme_name().as_ref() != theme_name(mode) {
        Theme::change(mode, window, cx);
        apply_mode_tokens(mode, cx);
    }
    let reduce_motion = AppModels::global(cx)
        .settings()
        .read(cx)
        .settings()
        .reduce_motion;
    if cx.reduce_motion() != reduce_motion {
        cx.set_reduce_motion(reduce_motion);
        cx.refresh_windows();
    }
    sync_glass(mode, cx);
}

/// The Kit mode the persisted preference resolves to under `appearance`.
pub fn mode_for(preference: ThemePreference, appearance: WindowAppearance) -> ThemeMode {
    match preference {
        ThemePreference::Light => ThemeMode::Light,
        ThemePreference::Dark => ThemeMode::Dark,
        ThemePreference::System => appearance.into(),
    }
}

fn theme_name(mode: ThemeMode) -> &'static str {
    if mode.is_dark() {
        DARK_THEME_NAME
    } else {
        LIGHT_THEME_NAME
    }
}

fn resolved_mode(window: Option<&Window>, cx: &App) -> ThemeMode {
    let preference = AppModels::global(cx).settings().read(cx).settings().theme;
    let appearance = window.map_or_else(|| cx.window_appearance(), Window::appearance);
    mode_for(preference, appearance)
}

/// Per-mode edits on top of the loaded config: the primary surface is a
/// leading-to-trailing gradient (the token carries a `Background`, the color
/// stays solid for text and borders). Kit paints the brand badge from
/// `primary` and the primary button from `button_primary`, so both carry it.
/// Every stop keeps the primary foreground at 4.5:1 or better.
fn apply_mode_tokens(mode: ThemeMode, cx: &mut App) {
    let (from, to) = if mode.is_dark() {
        (0x5ac8_faff, 0x2b93_ffff)
    } else {
        (0x1670_f0ff, 0x0a5c_e0ff)
    };
    let gradient = linear_gradient(
        90.,
        linear_color_stop(hsla(from), 0.),
        linear_color_stop(hsla(to), 1.),
    );
    Theme::update(cx, |theme| {
        theme.tokens.primary = ThemeToken::new(theme.primary, gradient);
        theme.tokens.button_primary = ThemeToken::new(theme.button_primary, gradient);
    });
}

fn sync_glass(mode: ThemeMode, cx: &mut App) {
    if cx
        .try_global::<GlassTokens>()
        .is_some_and(|glass| glass.mode == mode)
    {
        return;
    }
    let palette = GlassPalette::for_mode(mode);
    let backdrop = {
        let sync = cx.global_mut::<ThemeSync>();
        Arc::clone(
            sync.backdrops
                .entry(mode)
                .or_insert_with(|| palette.backdrop.render()),
        )
    };
    cx.set_global(palette.into_tokens(mode, backdrop));
}

/// Reads the glass tokens of the active mode. Available once [`install`] ran.
pub trait ActiveGlass {
    fn glass(&self) -> &GlassTokens;
}

impl ActiveGlass for App {
    #[inline]
    fn glass(&self) -> &GlassTokens {
        self.global::<GlassTokens>()
    }
}

/// Application-owned surfaces of the glass design, resolved for one mode.
#[derive(Clone)]
pub struct GlassTokens {
    mode: ThemeMode,
    backdrop: Arc<RenderImage>,
    panel: Hsla,
    panel_border: Hsla,
    panel_shadows: Vec<BoxShadow>,
    bar: Hsla,
    bar_border: Hsla,
    bar_shadows: Vec<BoxShadow>,
    chip: Hsla,
    chip_strong: Hsla,
    lift_shadows: Vec<BoxShadow>,
    well: Hsla,
    well_border: Hsla,
    primary_shadows: Vec<BoxShadow>,
}

impl Global for GlassTokens {}

impl GlassTokens {
    pub fn mode(&self) -> ThemeMode {
        self.mode
    }

    /// The soft-light backdrop behind every panel; draw it with
    /// `ObjectFit::Cover` so it fills any window size.
    pub fn backdrop(&self) -> Arc<RenderImage> {
        Arc::clone(&self.backdrop)
    }

    pub fn panel_background(&self) -> Hsla {
        self.panel
    }

    pub fn panel_border(&self) -> Hsla {
        self.panel_border
    }

    /// Drop shadow plus the inset specular highlight along the top edge.
    pub fn panel_shadows(&self) -> Vec<BoxShadow> {
        self.panel_shadows.clone()
    }

    pub fn bar_background(&self) -> Hsla {
        self.bar
    }

    pub fn bar_border(&self) -> Hsla {
        self.bar_border
    }

    pub fn bar_shadows(&self) -> Vec<BoxShadow> {
        self.bar_shadows.clone()
    }

    /// The quiet fill of a track or chip inside a panel (segmented control
    /// track, count chip, the output folder button).
    pub fn chip(&self) -> Hsla {
        self.chip
    }

    /// The raised fill of a selected segment or a small control that sits
    /// on a chip; pair it with [`Self::lift_shadows`].
    pub fn chip_strong(&self) -> Hsla {
        self.chip_strong
    }

    /// The one-pixel lift under a raised chip (none in the dark palette,
    /// where the lighter fill already separates it).
    pub fn lift_shadows(&self) -> Vec<BoxShadow> {
        self.lift_shadows.clone()
    }

    pub fn well_background(&self) -> Hsla {
        self.well
    }

    pub fn well_border(&self) -> Hsla {
        self.well_border
    }

    /// The glow under the one primary button of the window.
    pub fn primary_shadows(&self) -> Vec<BoxShadow> {
        self.primary_shadows.clone()
    }
}

/// Glass surface styles for any element.
pub trait GlassStyled: Styled + Sized {
    /// A translucent card: fill, hairline stroke, specular highlight, soft
    /// drop shadow and the large surface radius.
    fn glass_panel(self, cx: &App) -> Self {
        let glass = cx.glass();
        self.bg(glass.panel_background())
            .border_1()
            .border_color(glass.panel_border())
            .rounded(cx.theme().radius_2xl())
            .shadow(glass.panel_shadows())
    }

    /// The floating capsule that carries the window's decision. It is
    /// nearly opaque: without a backdrop blur, rows behind a lighter fill
    /// would show through its text.
    fn glass_bar(self, cx: &App) -> Self {
        let glass = cx.glass();
        self.bg(glass.bar_background())
            .border_1()
            .border_color(glass.bar_border())
            .rounded(cx.theme().radius_full())
            .shadow(glass.bar_shadows())
    }

    /// A pill-shaped glass strip for window-level commands.
    fn glass_capsule(self, cx: &App) -> Self {
        let glass = cx.glass();
        self.bg(glass.panel_background())
            .border_1()
            .border_color(glass.panel_border())
            .rounded(cx.theme().radius_full())
            .shadow(glass.panel_shadows())
    }

    /// A grouped block inside a panel (switch lists, nested options).
    fn glass_well(self, cx: &App) -> Self {
        let glass = cx.glass();
        self.bg(glass.well_background())
            .border_1()
            .border_color(glass.well_border())
            .rounded(cx.theme().radius_lg)
    }
}

impl<E: Styled> GlassStyled for E {}

// ---- palette (the only place with raw values besides the theme file) ----

struct GlassPalette {
    backdrop: Backdrop,
    panel: Hsla,
    panel_border: Hsla,
    highlight: Hsla,
    panel_shadow: (Pixels, Pixels, Hsla),
    bar: Hsla,
    bar_border: Hsla,
    bar_shadow: (Pixels, Pixels, Hsla),
    /// A hairline ring around panels and the capsule; on a light backdrop a
    /// white stroke alone does not separate them.
    outline: Option<Hsla>,
    chip: Hsla,
    chip_strong: Hsla,
    lift: Option<Hsla>,
    well: Hsla,
    well_border: Hsla,
    primary_glow: (Pixels, Pixels, Hsla),
}

impl GlassPalette {
    fn for_mode(mode: ThemeMode) -> Self {
        if mode.is_dark() {
            Self {
                backdrop: Backdrop {
                    base: rgba(0x0b0e_16ff),
                    blobs: vec![
                        Blob::new(0x2b6c_ffff, (0.12, 0.18), 0.48, 0.42),
                        Blob::new(0xff4f_a0ff, (0.88, 0.12), 0.42, 0.30),
                        Blob::new(0x22d3_eeff, (0.60, 1.00), 0.50, 0.26),
                    ],
                },
                panel: hsla(0xffff_ff11),
                panel_border: hsla(0xffff_ff24),
                highlight: hsla(0xffff_ff1a),
                panel_shadow: (px(20.), px(50.), hsla(0x0000_0059)),
                bar: hsla(0x161a_26f0),
                bar_border: hsla(0xffff_ff24),
                bar_shadow: (px(18.), px(40.), hsla(0x0000_0080)),
                outline: None,
                chip: hsla(0xffff_ff12),
                chip_strong: hsla(0xffff_ff24),
                lift: None,
                well: hsla(0xffff_ff12),
                well_border: hsla(0x0000_0000),
                primary_glow: (px(6.), px(18.), hsla(0x2b93_ff73)),
            }
        } else {
            Self {
                backdrop: Backdrop {
                    base: rgba(0xe8eb_f1ff),
                    blobs: vec![
                        Blob::new(0xffff_ffff, (0.08, 0.06), 0.52, 1.00),
                        Blob::new(0xffda_e9ff, (0.92, 0.04), 0.44, 0.85),
                        Blob::new(0xbeda_ffff, (0.72, 1.04), 0.54, 0.95),
                        Blob::new(0xd0f2_e8ff, (0.04, 1.00), 0.36, 0.80),
                    ],
                },
                panel: hsla(0xffff_ff9e),
                panel_border: hsla(0xffff_fff5),
                highlight: hsla(0xffff_ffff),
                panel_shadow: (px(18.), px(44.), hsla(0x1e2d_5017)),
                bar: hsla(0xffff_fff5),
                bar_border: hsla(0xffff_fff5),
                bar_shadow: (px(16.), px(40.), hsla(0x1e2d_5029)),
                outline: Some(hsla(0x1420_3c0b)),
                chip: hsla(0x0f16_240b),
                chip_strong: hsla(0xffff_ffff),
                lift: Some(hsla(0x1420_3c14)),
                well: hsla(0xffff_ffb3),
                well_border: hsla(0x1420_3c0f),
                primary_glow: (px(6.), px(16.), hsla(0x0a74_ff52)),
            }
        }
    }

    fn into_tokens(self, mode: ThemeMode, backdrop: Arc<RenderImage>) -> GlassTokens {
        let highlight = BoxShadow::new(px(0.), px(1.), self.highlight).inset();
        let drop = |(offset_y, blur, color): (Pixels, Pixels, Hsla)| {
            BoxShadow::new(px(0.), offset_y, color).blur_radius(blur)
        };
        let outline = self
            .outline
            .map(|color| BoxShadow::new(px(0.), px(0.), color).spread_radius(px(1.)));
        let with_outline = |mut shadows: Vec<BoxShadow>| {
            shadows.extend(outline.clone());
            shadows
        };
        GlassTokens {
            mode,
            backdrop,
            panel: self.panel,
            panel_border: self.panel_border,
            panel_shadows: with_outline(vec![drop(self.panel_shadow), highlight.clone()]),
            bar: self.bar,
            bar_border: self.bar_border,
            bar_shadows: with_outline(vec![drop(self.bar_shadow), highlight]),
            chip: self.chip,
            chip_strong: self.chip_strong,
            lift_shadows: self
                .lift
                .map(|color| vec![BoxShadow::new(px(0.), px(1.), color).blur_radius(px(2.))])
                .unwrap_or_default(),
            well: self.well,
            well_border: self.well_border,
            primary_shadows: vec![drop(self.primary_glow)],
        }
    }
}

fn hsla(hex: u32) -> Hsla {
    rgba(hex).into()
}

// ---- backdrop ----

/// Resolution of the generated backdrop. The content is a few Gaussian
/// blobs, so the GPU's bilinear upscale to window size stays smooth; a
/// dither keeps 8-bit banding out of the long gradients.
const BACKDROP_WIDTH: u32 = 192;
const BACKDROP_HEIGHT: u32 = 120;

struct Blob {
    color: Rgba,
    /// Center in backdrop-relative coordinates (0..1 of width and height).
    center: (f32, f32),
    /// Radius in fractions of the width; the falloff is Gaussian.
    radius: f32,
    alpha: f32,
}

impl Blob {
    fn new(hex: u32, center: (f32, f32), radius: f32, alpha: f32) -> Self {
        Self {
            color: rgba(hex),
            center,
            radius,
            alpha,
        }
    }
}

struct Backdrop {
    base: Rgba,
    blobs: Vec<Blob>,
}

impl Backdrop {
    fn render(&self) -> Arc<RenderImage> {
        const BAYER: [[f32; 4]; 4] = [
            [0., 8., 2., 10.],
            [12., 4., 14., 6.],
            [3., 11., 1., 9.],
            [15., 7., 13., 5.],
        ];
        let (width, height) = (BACKDROP_WIDTH, BACKDROP_HEIGHT);
        let aspect = height as f32 / width as f32;
        let mut image = RgbaImage::new(width, height);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            let (u, v) = (x as f32 / width as f32, y as f32 / height as f32);
            let mut rgb = [self.base.r, self.base.g, self.base.b];
            for blob in &self.blobs {
                let dx = u - blob.center.0;
                let dy = (v - blob.center.1) * aspect;
                let sigma = blob.radius / 2.;
                let weight = blob.alpha * (-(dx * dx + dy * dy) / (2. * sigma * sigma)).exp();
                let color = [blob.color.r, blob.color.g, blob.color.b];
                for (channel, value) in rgb.iter_mut().zip(color) {
                    *channel = *channel * (1. - weight) + value * weight;
                }
            }
            let dither = (BAYER[(y % 4) as usize][(x % 4) as usize] / 16. - 0.5) / 255.;
            let quantize = |value: f32| ((value + dither).clamp(0., 1.) * 255.).round() as u8;
            // GPUI render frames are BGRA.
            *pixel = image::Rgba([
                quantize(rgb[2]),
                quantize(rgb[1]),
                quantize(rgb[0]),
                u8::MAX,
            ]);
        }
        Arc::new(RenderImage::new(vec![Frame::new(image)]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preference_resolves_against_the_system_appearance() {
        assert_eq!(
            mode_for(ThemePreference::System, WindowAppearance::Dark),
            ThemeMode::Dark
        );
        assert_eq!(
            mode_for(ThemePreference::System, WindowAppearance::VibrantLight),
            ThemeMode::Light
        );
        assert_eq!(
            mode_for(ThemePreference::Light, WindowAppearance::Dark),
            ThemeMode::Light
        );
        assert_eq!(
            mode_for(ThemePreference::Dark, WindowAppearance::Light),
            ThemeMode::Dark
        );
    }

    #[test]
    fn bundled_theme_file_declares_both_modes() {
        let set: serde_json::Value = serde_json::from_str(THEME_SET).unwrap();
        let names: Vec<&str> = set["themes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|theme| theme["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, [LIGHT_THEME_NAME, DARK_THEME_NAME]);
    }

    #[test]
    fn backdrop_is_opaque_and_tinted_by_its_blobs() {
        let backdrop = GlassPalette::for_mode(ThemeMode::Dark).backdrop;
        let image = backdrop.render();
        let size = image.size(0);
        assert_eq!(
            (size.width.0, size.height.0),
            (BACKDROP_WIDTH.cast_signed(), BACKDROP_HEIGHT.cast_signed())
        );
    }
}
