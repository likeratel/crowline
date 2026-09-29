use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    webview::{Color, WebviewWindowBuilder},
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Rect, Theme, WebviewUrl,
};

pub(crate) const MAIN_LABEL: &str = "main";
pub(crate) const DASHBOARD_LABEL: &str = "dashboard";

const PANEL_GAP_LOGICAL: f64 = 8.0;
const DASHBOARD_WIDTH: f64 = 1_080.0;
const DASHBOARD_HEIGHT: f64 = 780.0;
const DASHBOARD_MIN_WIDTH: f64 = 720.0;
const DASHBOARD_MIN_HEIGHT: f64 = 520.0;

#[derive(Default)]
pub(crate) struct PanelFocusState {
    hide_on_blur: AtomicBool,
}

impl PanelFocusState {
    fn prepare_to_show(&self) {
        self.hide_on_blur.store(false, Ordering::SeqCst);
    }

    pub(crate) fn focus_changed(&self, focused: bool) -> bool {
        if focused {
            self.hide_on_blur.store(true, Ordering::SeqCst);
            false
        } else {
            self.hide_on_blur.swap(false, Ordering::SeqCst)
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct PixelRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

pub(crate) fn hide_panel(app: &AppHandle) -> Result<(), String> {
    let panel = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "The status panel is unavailable.".to_owned())?;
    if let Some(state) = app.try_state::<PanelFocusState>() {
        state.prepare_to_show();
    }
    panel
        .hide()
        .map_err(|_| "The status panel could not be hidden.".to_owned())
}

pub(crate) fn show_panel(app: &AppHandle, anchor: Option<(Rect, PhysicalPosition<f64>)>) {
    let Some(panel) = app.get_webview_window(MAIN_LABEL) else {
        return;
    };

    if let Some(state) = app.try_state::<PanelFocusState>() {
        state.prepare_to_show();
    }
    #[cfg(target_os = "macos")]
    let _ = app.show();
    if let Some((rect, click_position)) = anchor {
        position_panel(app, &panel, rect, click_position);
    }
    let _ = panel.unminimize();
    let _ = panel.show();
    let _ = panel.set_focus();
    if panel.is_focused().unwrap_or(false) {
        if let Some(state) = app.try_state::<PanelFocusState>() {
            state.focus_changed(true);
        }
    }
}

pub(crate) fn toggle_panel(app: &AppHandle, rect: Rect, click_position: PhysicalPosition<f64>) {
    let Some(panel) = app.get_webview_window(MAIN_LABEL) else {
        return;
    };

    if panel.is_visible().unwrap_or(false) {
        let _ = panel.hide();
    } else {
        show_panel(app, Some((rect, click_position)));
    }
}

pub(crate) fn open_dashboard(app: &AppHandle) -> Result<(), String> {
    if let Some(dashboard) = app.get_webview_window(DASHBOARD_LABEL) {
        dashboard
            .unminimize()
            .map_err(|_| "The dashboard could not be restored.".to_owned())?;
        dashboard
            .show()
            .map_err(|_| "The dashboard could not be shown.".to_owned())?;
        return dashboard
            .set_focus()
            .map_err(|_| "The dashboard could not be focused.".to_owned());
    }

    WebviewWindowBuilder::new(
        app,
        DASHBOARD_LABEL,
        WebviewUrl::App("index.html?view=dashboard".into()),
    )
    .title("crowline dashboard")
    .inner_size(DASHBOARD_WIDTH, DASHBOARD_HEIGHT)
    .min_inner_size(DASHBOARD_MIN_WIDTH, DASHBOARD_MIN_HEIGHT)
    .resizable(true)
    .decorations(true)
    .always_on_top(false)
    .skip_taskbar(false)
    .theme(Some(Theme::Dark))
    .background_color(Color(13, 14, 16, 255))
    .center()
    .build()
    .map(|_| ())
    .map_err(|_| "The dashboard could not be opened.".to_owned())
}

fn position_panel(
    app: &AppHandle,
    panel: &tauri::WebviewWindow,
    tray_rect: Rect,
    click_position: PhysicalPosition<f64>,
) {
    let monitor = app
        .monitor_from_point(click_position.x, click_position.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let Ok(panel_size) = panel.outer_size() else {
        return;
    };

    let scale = monitor.scale_factor();
    let tray_position = tray_rect.position.to_physical::<f64>(scale);
    let tray_size = tray_rect.size.to_physical::<f64>(scale);
    let tray = PixelRect {
        x: tray_position.x,
        y: tray_position.y,
        width: tray_size.width,
        height: tray_size.height,
    };
    let work_area = monitor.work_area();
    let work = PixelRect {
        x: f64::from(work_area.position.x),
        y: f64::from(work_area.position.y),
        width: f64::from(work_area.size.width),
        height: f64::from(work_area.size.height),
    };
    let position = anchored_position(tray, work, panel_size, PANEL_GAP_LOGICAL * scale);
    let _ = panel.set_position(position);
}

fn anchored_position(
    tray: PixelRect,
    work: PixelRect,
    panel: PhysicalSize<u32>,
    gap: f64,
) -> PhysicalPosition<i32> {
    let panel_width = f64::from(panel.width);
    let panel_height = f64::from(panel.height);
    let work_right = work.x + work.width;
    let work_bottom = work.y + work.height;
    let max_x = (work_right - panel_width).max(work.x);
    let max_y = (work_bottom - panel_height).max(work.y);

    let centered_x = tray.x + (tray.width - panel_width) / 2.0;
    let below = tray.y + tray.height + gap;
    let above = tray.y - panel_height - gap;
    let preferred_y = if below + panel_height <= work_bottom {
        below
    } else if above >= work.y {
        above
    } else {
        below
    };

    PhysicalPosition::new(
        centered_x.clamp(work.x, max_x).round() as i32,
        preferred_y.clamp(work.y, max_y).round() as i32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_anchors_below_a_top_tray_and_clamps_to_work_area() {
        let position = anchored_position(
            PixelRect {
                x: 1_880.0,
                y: 0.0,
                width: 40.0,
                height: 24.0,
            },
            PixelRect {
                x: 0.0,
                y: 24.0,
                width: 1_920.0,
                height: 1_056.0,
            },
            PhysicalSize::new(420, 540),
            8.0,
        );

        assert_eq!(position, PhysicalPosition::new(1_500, 32));
    }

    #[test]
    fn panel_anchors_above_a_bottom_taskbar() {
        let position = anchored_position(
            PixelRect {
                x: 900.0,
                y: 1_040.0,
                width: 40.0,
                height: 40.0,
            },
            PixelRect {
                x: 0.0,
                y: 0.0,
                width: 1_920.0,
                height: 1_040.0,
            },
            PhysicalSize::new(420, 540),
            8.0,
        );

        assert_eq!(position, PhysicalPosition::new(710, 492));
    }

    #[test]
    fn panel_handles_negative_monitor_coordinates() {
        let position = anchored_position(
            PixelRect {
                x: -1_920.0,
                y: -24.0,
                width: 32.0,
                height: 24.0,
            },
            PixelRect {
                x: -1_920.0,
                y: 0.0,
                width: 1_920.0,
                height: 1_080.0,
            },
            PhysicalSize::new(840, 1_080),
            16.0,
        );

        assert_eq!(position, PhysicalPosition::new(-1_920, 0));
    }

    #[test]
    fn panel_hides_only_after_it_has_received_focus() {
        let state = PanelFocusState::default();

        assert!(!state.focus_changed(false));
        assert!(!state.focus_changed(true));
        assert!(state.focus_changed(false));
        assert!(!state.focus_changed(false));

        state.focus_changed(true);
        state.prepare_to_show();
        assert!(!state.focus_changed(false));
    }
}
