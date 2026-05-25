use crate::error::{JetError, JetResult};
use crate::ssh::{ConnectRequest, RemoteEntry, SshConnection};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub home: String,
}

pub struct SessionStore {
    inner: RwLock<HashMap<String, Arc<SshConnection>>>,
    meta: RwLock<HashMap<String, SessionInfo>>,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
            meta: RwLock::new(HashMap::new()),
        }
    }

    pub fn add(&self, conn: SshConnection, info: SessionInfo) {
        let id = info.id.clone();
        self.inner.write().insert(id.clone(), Arc::new(conn));
        self.meta.write().insert(id, info);
    }

    pub fn remove(&self, id: &str) {
        self.inner.write().remove(id);
        self.meta.write().remove(id);
    }

    pub fn get(&self, id: &str) -> JetResult<Arc<SshConnection>> {
        self.inner
            .read()
            .get(id)
            .cloned()
            .ok_or_else(|| JetError::SessionNotFound(id.into()))
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        self.meta.read().values().cloned().collect()
    }
}

#[tauri::command]
pub fn cmd_connect(
    store: tauri::State<'_, Arc<SessionStore>>,
    req: ConnectRequest,
) -> JetResult<SessionInfo> {
    let conn = SshConnection::connect(&req)?;

    let home = conn
        .sftp()
        .realpath(std::path::Path::new("."))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "/".into());

    let info = SessionInfo {
        id: Uuid::new_v4().to_string(),
        host: req.host.clone(),
        port: req.port,
        username: req.username.clone(),
        home,
    };
    store.add(conn, info.clone());
    Ok(info)
}

#[tauri::command]
pub fn cmd_disconnect(store: tauri::State<'_, Arc<SessionStore>>, id: String) -> JetResult<()> {
    store.remove(&id);
    Ok(())
}

#[tauri::command]
pub fn cmd_list_dir(
    store: tauri::State<'_, Arc<SessionStore>>,
    id: String,
    path: String,
) -> JetResult<Vec<RemoteEntry>> {
    let conn = store.get(&id)?;
    conn.list_dir(&path)
}

#[tauri::command]
pub fn cmd_list_sessions(store: tauri::State<'_, Arc<SessionStore>>) -> Vec<SessionInfo> {
    store.list()
}

#[tauri::command]
pub fn cmd_mkdir(
    store: tauri::State<'_, Arc<SessionStore>>,
    id: String,
    path: String,
) -> JetResult<()> {
    let conn = store.get(&id)?;
    conn.sftp().mkdir(std::path::Path::new(&path), 0o755)?;
    Ok(())
}

#[tauri::command]
pub fn cmd_rename(
    store: tauri::State<'_, Arc<SessionStore>>,
    id: String,
    from: String,
    to: String,
) -> JetResult<()> {
    let conn = store.get(&id)?;
    // None for flags = default behavior (overwrite-if-allowed by server).
    conn.sftp().rename(
        std::path::Path::new(&from),
        std::path::Path::new(&to),
        None,
    )?;
    Ok(())
}

#[tauri::command]
pub fn cmd_delete(
    store: tauri::State<'_, Arc<SessionStore>>,
    id: String,
    path: String,
) -> JetResult<()> {
    let conn = store.get(&id)?;
    // Use lstat semantics (don't follow symlinks): readdir/lstat-based
    // checks ensure we unlink a symlink-to-dir rather than recursing into it.
    let lstat = conn.sftp().lstat(std::path::Path::new(&path))?;
    let ft = lstat.file_type();
    if ft == ssh2::FileType::Directory {
        delete_dir_recursive(&conn, &path)?;
    } else {
        conn.sftp().unlink(std::path::Path::new(&path))?;
    }
    Ok(())
}

fn delete_dir_recursive(conn: &crate::ssh::SshConnection, path: &str) -> JetResult<()> {
    let entries = conn.sftp().readdir(std::path::Path::new(path))?;
    for (entry_path, stat) in entries {
        let name = entry_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if name == "." || name == ".." {
            continue;
        }
        let sp = entry_path.to_string_lossy().into_owned();
        // readdir returns lstat — symlinks-to-dirs are NOT seen as directories,
        // so we correctly `unlink` them instead of descending.
        if stat.file_type() == ssh2::FileType::Directory {
            delete_dir_recursive(conn, &sp)?;
        } else {
            conn.sftp().unlink(&entry_path)?;
        }
    }
    conn.sftp().rmdir(std::path::Path::new(path))?;
    Ok(())
}
