//! Remembers the main window's place, size and mode between runs.
//!
//! The state lives in `gpui-window-state.json` next to `settings.json`, which
//! stays untouched because the Tauri shell shares it. Rectangles are local to
//! the display they were on (top-left origin), and the display is named by
//! its UUID, so a window comes back on the same monitor whatever the
//! arrangement, or centred on the primary one when that monitor is gone or
//! the rectangle no longer shows enough of the window.

use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use gpui_kit::{
    AnyWindowHandle, App, Bounds, DisplayId, Global, Pixels, Size, Window, point, px, size,
};
use serde::{Deserialize, Serialize};

pub const FILE_NAME: &str = "gpui-window-state.json";

/// The default content size of the main window.
pub const DEFAULT_SIZE: (f32, f32) = (1_080., 720.);
/// The smallest content size the main window allows.
pub const MIN_SIZE: (f32, f32) = (760., 480.);
/// How much of a restored window must lie inside the display's visible area.
const MIN_VISIBLE: f32 = 100.;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    #[default]
    Windowed,
    Fullscreen,
}

/// A display-local rectangle: `x`/`y` is the frame's top-left corner, `w`/`h`
/// the content size.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    fn is_valid(self) -> bool {
        [self.x, self.y, self.w, self.h]
            .iter()
            .all(|v| v.is_finite())
            && self.w > 0.
            && self.h > 0.
    }

    fn from_bounds(bounds: Bounds<Pixels>) -> Self {
        Self {
            x: bounds.origin.x.as_f32(),
            y: bounds.origin.y.as_f32(),
            w: bounds.size.width.as_f32(),
            h: bounds.size.height.as_f32(),
        }
    }

    fn to_bounds(self) -> Bounds<Pixels> {
        Bounds::new(point(px(self.x), px(self.y)), size(px(self.w), px(self.h)))
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub struct Saved {
    pub kind: Kind,
    pub maximized: bool,
    /// Where the window goes when it is neither full screen nor maximized.
    pub restore: Rect,
    pub display_uuid: Option<String>,
}

/// A display as [`resolve`] sees it.
pub struct DisplayInfo {
    pub uuid: Option<String>,
    /// The area not covered by the menu bar or the Dock, display-local.
    pub visible: Rect,
}

/// Reads the saved state; a missing, unreadable or implausible file counts
/// as none.
pub fn load(path: &Path) -> Option<Saved> {
    let saved: Saved = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    saved.restore.is_valid().then_some(saved)
}

/// Writes the state through a temporary file, so a crash never leaves half
/// of it.
pub fn store(path: &Path, saved: &Saved) -> io::Result<()> {
    let bytes = serde_json::to_vec_pretty(saved).map_err(io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

/// Picks the display for `saved` (its own by UUID, else `primary`) and the
/// rectangle to open at, shrunk to fit the visible area. `None` for the
/// rectangle means "centred at the default size" on that display; `None`
/// overall means no display is known.
pub fn resolve(
    saved: &Saved,
    displays: &[DisplayInfo],
    primary: Option<usize>,
) -> Option<(usize, Option<Rect>)> {
    let index = saved
        .display_uuid
        .as_ref()
        .and_then(|uuid| displays.iter().position(|d| d.uuid.as_ref() == Some(uuid)))
        .or(primary)?;
    let visible = displays.get(index)?.visible;
    Some((index, fit(saved.restore, visible)))
}

/// `rect` with its size capped to `visible`, or `None` when less than
/// [`MIN_VISIBLE`] of it would show in either direction.
fn fit(rect: Rect, visible: Rect) -> Option<Rect> {
    let w = rect.w.min(visible.w).max(MIN_SIZE.0.min(visible.w));
    let h = rect.h.min(visible.h).max(MIN_SIZE.1.min(visible.h));
    let overlap_x = (rect.x + w).min(visible.x + visible.w) - rect.x.max(visible.x);
    let overlap_y = (rect.y + h).min(visible.y + visible.h) - rect.y.max(visible.y);
    // The title bar must stay reachable: the top edge may not sit above the
    // visible area.
    (overlap_x >= MIN_VISIBLE && overlap_y >= MIN_VISIBLE && rect.y >= visible.y).then_some(Rect {
        w,
        h,
        ..rect
    })
}

/// What [`open_options`] tells the main window.
pub struct Placement {
    pub bounds: Bounds<Pixels>,
    pub display: Option<DisplayId>,
    pub kind: Kind,
    pub maximized: bool,
}

struct Tracker {
    path: PathBuf,
    saved: Option<Saved>,
    window: Option<AnyWindowHandle>,
    /// Bumped on every bounds change; a pending commit only lands if no
    /// change came after it.
    moves: u64,
    /// Full screen and maximized as of the last bounds change. Quitting from
    /// a menu or the close button happens inside the window's own update,
    /// where the window cannot be read again.
    mode: Option<(bool, bool)>,
}

impl Global for Tracker {}

/// How long the window must keep still before its frame counts as a place
/// to come back to. Zooming and entering full screen animate through
/// windowed frames first; those must not become the restore rectangle.
const SETTLE: Duration = Duration::from_millis(500);

/// Loads the state from `path` and saves it again when the app quits.
pub fn install(path: PathBuf, cx: &mut App) {
    let saved = load(&path);
    cx.set_global(Tracker {
        path,
        saved,
        window: None,
        moves: 0,
        mode: None,
    });
    imgconvert_gpui_shared::lifecycle::on_before_quit(save, cx);
}

/// Where to open the main window: the saved place when [`install`] ran and
/// it still fits, else centred at the default size.
pub fn open_options(cx: &App) -> Placement {
    let default_size = size(px(DEFAULT_SIZE.0), px(DEFAULT_SIZE.1));
    let saved = cx.try_global::<Tracker>().and_then(|t| t.saved.clone());
    let displays = cx.displays();
    let primary = cx.primary_display();
    let resolved = saved.as_ref().and_then(|saved| {
        let infos: Vec<DisplayInfo> = displays
            .iter()
            .map(|d| DisplayInfo {
                uuid: d.uuid().ok().map(|u| u.to_string()),
                visible: Rect::from_bounds(d.visible_bounds()),
            })
            .collect();
        let primary = primary
            .as_ref()
            .and_then(|p| displays.iter().position(|d| d.id() == p.id()));
        resolve(saved, &infos, primary)
    });
    let Some((index, rect)) = resolved else {
        return Placement {
            bounds: Bounds::centered(None, default_size, cx),
            display: None,
            kind: Kind::Windowed,
            maximized: false,
        };
    };
    let display = displays[index].id();
    let saved = saved.unwrap_or_else(|| unreachable!("resolved implies saved"));
    Placement {
        bounds: rect.map_or_else(
            || Bounds::centered(Some(display), default_size, cx),
            Rect::to_bounds,
        ),
        display: Some(display),
        kind: saved.kind,
        maximized: saved.maximized,
    }
}

/// Starts following `window`, the main window, and re-enters the saved
/// mode once it is on screen.
pub fn attach(window: AnyWindowHandle, placement: &Placement, cx: &mut App) {
    if let Some(tracker) = tracker(cx) {
        tracker.window = Some(window);
        // Where the window opened is its place until it moves, so quitting
        // straight from full screen still has something to return to.
        tracker.saved.get_or_insert(Saved {
            kind: Kind::Windowed,
            maximized: false,
            restore: Rect::from_bounds(placement.bounds),
            display_uuid: None,
        });
    }
    let (kind, maximized) = (placement.kind, placement.maximized);
    if kind == Kind::Windowed && !maximized {
        return;
    }
    // After the first frame: zooming a window that is not on screen yet
    // leaves AppKit without the frame to return to.
    let _ = window.update(cx, |_, window, _| {
        window.on_next_frame(move |window, _| {
            if kind == Kind::Fullscreen {
                window.toggle_fullscreen();
            } else {
                window.zoom_window();
            }
        });
    });
}

/// Follows a bounds change of the main window: once it has kept still for
/// [`SETTLE`], its windowed frame becomes the place to restore.
pub fn track(window: &Window, cx: &mut App) {
    let mode = (window.is_fullscreen(), window.is_maximized());
    let Some(state) = tracker(cx) else {
        return;
    };
    state.mode = Some(mode);
    state.moves += 1;
    let moves = state.moves;
    let handle = window.window_handle();
    let timer = cx.background_executor().timer(SETTLE);
    cx.spawn(async move |cx| {
        timer.await;
        cx.update(|cx| {
            if tracker(cx).is_some_and(|state| state.moves == moves) {
                let _ = handle.update(cx, |_, window, cx| commit(window, cx));
            }
        });
    })
    .detach();
}

/// Records the window's windowed place; full-screen and maximized frames
/// are not places to come back to.
fn commit(window: &Window, cx: &mut App) {
    if window.is_fullscreen() || window.is_maximized() {
        return;
    }
    let restore = windowed_rect(window.bounds(), window.viewport_size());
    let display_uuid = display_uuid(window, cx);
    if let Some(tracker) = tracker(cx) {
        let saved = tracker.saved.get_or_insert(Saved {
            kind: Kind::Windowed,
            maximized: false,
            restore,
            display_uuid: None,
        });
        saved.restore = restore;
        saved.display_uuid = display_uuid;
    }
}

fn windowed_rect(frame: Bounds<Pixels>, content: Size<Pixels>) -> Rect {
    Rect {
        x: frame.origin.x.as_f32(),
        y: frame.origin.y.as_f32(),
        w: content.width.as_f32(),
        h: content.height.as_f32(),
    }
}

fn display_uuid(window: &Window, cx: &App) -> Option<String> {
    window
        .display(cx)
        .and_then(|display| display.uuid().ok())
        .map(|uuid| uuid.to_string())
}

fn tracker(cx: &mut App) -> Option<&mut Tracker> {
    cx.has_global::<Tracker>()
        .then(|| cx.global_mut::<Tracker>())
}

fn save(cx: &mut App) {
    let Some(handle) = cx.try_global::<Tracker>().and_then(|t| t.window) else {
        return;
    };
    let mode = handle
        .update(cx, |_, window, cx| {
            commit(window, cx);
            (window.is_fullscreen(), window.is_maximized())
        })
        .ok();
    let Some(tracker) = tracker(cx) else {
        return;
    };
    let mode = mode.or(tracker.mode);
    let Some(saved) = tracker.saved.as_mut() else {
        return;
    };
    if let Some((fullscreen, maximized)) = mode {
        saved.kind = if fullscreen {
            Kind::Fullscreen
        } else {
            Kind::Windowed
        };
        saved.maximized = maximized && !fullscreen;
    }
    if let Err(error) = store(&tracker.path, saved) {
        eprintln!(
            "imgconvert: cannot save the window state to {}: {error}",
            tracker.path.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f32, y: f32, w: f32, h: f32) -> Rect {
        Rect { x, y, w, h }
    }

    fn saved(restore: Rect, display_uuid: Option<&str>) -> Saved {
        Saved {
            kind: Kind::Windowed,
            maximized: false,
            restore,
            display_uuid: display_uuid.map(str::to_owned),
        }
    }

    /// A laptop panel with an external monitor stacked above it. Rectangles
    /// are display-local, so both start at (0, menu bar).
    fn stacked() -> Vec<DisplayInfo> {
        vec![
            DisplayInfo {
                uuid: Some("laptop".into()),
                visible: rect(0., 25., 1_440., 850.),
            },
            DisplayInfo {
                uuid: Some("above".into()),
                visible: rect(0., 25., 2_560., 1_415.),
            },
        ]
    }

    #[test]
    fn a_window_returns_to_its_own_display_when_stacked() {
        let state = saved(rect(1_200., 300., 1_200., 800.), Some("above"));
        assert_eq!(
            resolve(&state, &stacked(), Some(0)),
            Some((1, Some(rect(1_200., 300., 1_200., 800.))))
        );
    }

    #[test]
    fn a_missing_display_falls_back_to_the_primary_one_and_shrinks_to_fit() {
        let state = saved(rect(100., 100., 2_000., 1_200.), Some("gone"));
        assert_eq!(
            resolve(&state, &stacked(), Some(0)),
            Some((0, Some(rect(100., 100., 1_440., 850.))))
        );
    }

    #[test]
    fn a_rectangle_that_would_show_too_little_is_centred_instead() {
        // Fits the external monitor, but would be almost off the laptop.
        let state = saved(rect(1_400., 300., 1_200., 800.), Some("gone"));
        assert_eq!(resolve(&state, &stacked(), Some(0)), Some((0, None)));
        // Above the menu bar: the title bar would be unreachable.
        let state = saved(rect(100., 0., 1_000., 700.), Some("laptop"));
        assert_eq!(resolve(&state, &stacked(), Some(0)), Some((0, None)));
    }

    #[test]
    fn no_display_means_no_placement() {
        let state = saved(rect(0., 25., 1_000., 700.), Some("laptop"));
        assert_eq!(resolve(&state, &[], None), None);
    }

    #[test]
    fn the_file_round_trips_and_damage_counts_as_none() {
        let dir =
            std::env::temp_dir().join(format!("imgconvert-window-state-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        let state = Saved {
            kind: Kind::Fullscreen,
            maximized: false,
            restore: rect(10., 40., 1_000., 700.),
            display_uuid: Some("laptop".into()),
        };
        store(&path, &state).unwrap();
        assert_eq!(load(&path), Some(state));
        std::fs::write(&path, b"{\"kind\":\"windowed\"").unwrap();
        assert_eq!(load(&path), None);
        std::fs::write(
            &path,
            br#"{"kind":"windowed","maximized":false,"restore":{"x":0,"y":0,"w":-5,"h":10},"display_uuid":null}"#,
        )
        .unwrap();
        assert_eq!(load(&path), None);
        std::fs::remove_dir_all(dir).ok();
    }
}
