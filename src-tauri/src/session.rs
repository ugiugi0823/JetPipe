use crate::conn::{local_home, Connection};
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
    /// "remote" | "local"
    pub kind: String,
}

pub struct SessionStore {
    inner: RwLock<HashMap<String, Arc<Connection>>>,
    meta: RwLock<HashMap<String, SessionInfo>>,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
            meta: RwLock::new(HashMap::new()),
        }
    }

    pub fn add(&self, conn: Connection, info: SessionInfo) {
        let id = info.id.clone();
        self.inner.write().insert(id.clone(), Arc::new(conn));
        self.meta.write().insert(id, info);
    }

    pub fn remove(&self, id: &str) {
        self.inner.write().remove(id);
        self.meta.write().remove(id);
    }

    pub fn get(&self, id: &str) -> JetResult<Arc<Connection>> {
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
        kind: "remote".into(),
    };
    store.add(Connection::Remote(conn), info.clone());
    Ok(info)
}

/// Register a local-filesystem "connection". No auth/handshake — it just
/// hands back a session id whose operations route to the local disk.
#[tauri::command]
pub fn cmd_connect_local(
    store: tauri::State<'_, Arc<SessionStore>>,
) -> JetResult<SessionInfo> {
    let home = local_home();
    let info = SessionInfo {
        id: Uuid::new_v4().to_string(),
        host: "localhost".into(),
        port: 0,
        username: "local".into(),
        home,
        kind: "local".into(),
    };
    store.add(Connection::Local, info.clone());
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
    conn.mkdir(&path)
}

#[tauri::command]
pub fn cmd_rename(
    store: tauri::State<'_, Arc<SessionStore>>,
    id: String,
    from: String,
    to: String,
) -> JetResult<()> {
    let conn = store.get(&id)?;
    conn.rename(&from, &to)
}

#[tauri::command]
pub fn cmd_delete(
    store: tauri::State<'_, Arc<SessionStore>>,
    id: String,
    path: String,
) -> JetResult<()> {
    let conn = store.get(&id)?;
    conn.delete(&path)
}
