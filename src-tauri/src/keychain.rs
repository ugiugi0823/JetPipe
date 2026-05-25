//! OS-native keychain bridge.
//!
//! On macOS this hits the Apple Keychain (Security framework); on Windows the
//! Credential Manager; on Linux Secret Service. JetPipe never persists
//! passwords/passphrases to its own files — secrets live in the OS vault
//! and are fetched on-demand at connect time.

use crate::error::{JetError, JetResult};
use keyring::Entry;

const SERVICE: &str = "com.jetpipe.app";

fn entry(account: &str) -> JetResult<Entry> {
    Entry::new(SERVICE, account).map_err(|e| JetError::Other(format!("keyring: {e}")))
}

#[tauri::command]
pub fn cmd_keychain_set(account: String, secret: String) -> JetResult<()> {
    let e = entry(&account)?;
    e.set_password(&secret)
        .map_err(|e| JetError::Other(format!("keyring set: {e}")))
}

#[tauri::command]
pub fn cmd_keychain_get(account: String) -> JetResult<Option<String>> {
    let e = entry(&account)?;
    match e.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(JetError::Other(format!("keyring get: {err}"))),
    }
}

#[tauri::command]
pub fn cmd_keychain_delete(account: String) -> JetResult<()> {
    let e = entry(&account)?;
    match e.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(JetError::Other(format!("keyring delete: {err}"))),
    }
}
