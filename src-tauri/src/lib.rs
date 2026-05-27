mod conn;
mod error;
mod keychain;
mod session;
mod ssh;
mod transfer;

use session::SessionStore;
use std::sync::Arc;
use transfer::CancelRegistry;

pub fn run() {
    let store = Arc::new(SessionStore::new());
    let cancels = Arc::new(CancelRegistry::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(store)
        .manage(cancels)
        .invoke_handler(tauri::generate_handler![
            session::cmd_connect,
            session::cmd_connect_local,
            session::cmd_disconnect,
            session::cmd_list_dir,
            session::cmd_list_sessions,
            session::cmd_mkdir,
            session::cmd_rename,
            session::cmd_delete,
            transfer::cmd_scan_conflicts,
            transfer::cmd_pipe_transfer,
            transfer::cmd_cancel_transfer,
            transfer::cmd_speedtest,
            keychain::cmd_keychain_set,
            keychain::cmd_keychain_get,
            keychain::cmd_keychain_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running JetPipe");
}
