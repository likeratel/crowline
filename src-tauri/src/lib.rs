mod cli;
mod commands;
mod login;
pub mod models;
pub mod providers;
mod settings;
mod state;
mod windows;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent, WindowEvent,
};

use state::AppState;

const MENU_OPEN: &str = "show-panel";
const MENU_DASHBOARD: &str = "open-dashboard";
const MENU_REFRESH: &str = "refresh";
const MENU_QUIT: &str = "quit";
pub(crate) const TRAY_ID: &str = "main-tray";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let app_data_dir = app.path().app_data_dir()?;
            let resource_dir = app.path().resource_dir().ok();
            let state = tauri::async_runtime::block_on(AppState::initialize(
                app_data_dir,
                resource_dir.as_deref(),
            ));
            app.manage(state);
            app.manage(windows::PanelFocusState::default());
            build_tray(app)?;
            state::start_polling(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != windows::MAIN_LABEL {
                return;
            }
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                WindowEvent::Focused(focused) => {
                    let should_hide = window
                        .app_handle()
                        .state::<windows::PanelFocusState>()
                        .focus_changed(*focused);
                    if should_hide {
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::save_settings,
            commands::refresh,
            commands::discover,
            commands::create_connection,
            commands::remove_connection,
            commands::begin_login,
            commands::get_login_status,
            commands::open_external,
            commands::hide_panel,
            commands::open_dashboard,
        ])
        .build(tauri::generate_context!())
        .expect("crowline failed to build")
        .run(|app, event| match event {
            RunEvent::Ready => windows::show_panel(app, None),
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => windows::show_panel(app, None),
            _ => {}
        });
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, MENU_OPEN, "Show Panel", true, None::<&str>)?;
    let dashboard = MenuItem::with_id(app, MENU_DASHBOARD, "Open Dashboard", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, MENU_REFRESH, "Refresh", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::new(app)?;
    menu.append_items(&[&open, &dashboard, &refresh, &quit])?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("crowline")
        .menu(&menu)
        .icon_as_template(true)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN => windows::show_panel(app, None),
            MENU_DASHBOARD => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = windows::open_dashboard(&app);
                });
            }
            MENU_REFRESH => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<AppState>();
                    state.refresh(&app).await;
                });
            }
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                position,
                rect,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                windows::toggle_panel(tray.app_handle(), rect, position);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
