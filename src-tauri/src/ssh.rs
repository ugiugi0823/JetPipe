use crate::error::{JetError, JetResult};
use serde::{Deserialize, Serialize};
use ssh2::{FileType, MethodType, Session, Sftp};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Time we wait for the TCP three-way handshake before giving up on a
/// host. The OS default (~75s on macOS, ~21s on Windows) makes the UI
/// look frozen for users who forgot to bring up a VPN. 10s is plenty
/// for any reachable server and fails fast when the route is blocked.
const TCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Credential {
    Password { password: String },
    Key { private_key_path: String, passphrase: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectRequest {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub credential: Credential,
    /// Negotiate zlib compression with the server. Helps text/code, neutral or
    /// slightly negative for already-compressed binaries (videos, archives,
    /// .pt/.safetensors). Default off.
    #[serde(default)]
    pub compression: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

pub struct SshConnection {
    session: Session,
    sftp: Sftp,
    /// Original credentials, kept so the transfer layer can spin up
    /// additional sibling connections for parallel-stream transfers
    /// without forcing the UI to re-supply secrets.
    req: ConnectRequest,
}

impl SshConnection {
    pub fn connect(req: &ConnectRequest) -> JetResult<Self> {
        let addr_str = format!("{}:{}", req.host, req.port);

        // Resolve hostname → SocketAddr so we can apply an explicit connect
        // timeout. Without this, TcpStream::connect waits for the OS default
        // (~75s on macOS) before failing — terrible UX when the user forgot
        // to bring up a VPN or the host is firewalled.
        let resolved = (req.host.as_str(), req.port)
            .to_socket_addrs()
            .map_err(|e| JetError::Other(format!("dns resolve {}: {e}", req.host)))?
            .next()
            .ok_or_else(|| {
                JetError::Other(format!("no address resolved for {}", req.host))
            })?;

        let tcp = TcpStream::connect_timeout(&resolved, TCP_CONNECT_TIMEOUT)
            .map_err(|e| {
                JetError::Other(format!(
                    "tcp connect to {addr_str} timed out / failed ({e}); \
                     network/VPN/firewall?"
                ))
            })?;
        // Banner/handshake stalls are rarer — keep these moderate.
        tcp.set_read_timeout(Some(Duration::from_secs(30)))?;
        tcp.set_write_timeout(Some(Duration::from_secs(30)))?;

        let mut session = Session::new()?;
        session.set_tcp_stream(tcp);

        // NOTE: Earlier we set explicit method_pref for HostKey/Kex/Cipher/MAC
        // to force a broad algorithm list, but that turned out to break the
        // handshake on libssh2 builds that don't ship one of the listed
        // algorithms — method_pref replaces (not augments) the defaults, so
        // a partial intersection meant no acceptable algorithms. libssh2's
        // built-in defaults are already wide enough for any modern server.

        if req.compression {
            let _ = session.method_pref(
                MethodType::CompCs,
                "zlib@openssh.com,zlib,none",
            );
            let _ = session.method_pref(
                MethodType::CompSc,
                "zlib@openssh.com,zlib,none",
            );
        }

        // Annotate each phase so users see *where* the connection failed.
        session
            .handshake()
            .map_err(|e| JetError::Other(format!("handshake with {addr_str}: {e}")))?;

        match &req.credential {
            Credential::Password { password } => {
                session.userauth_password(&req.username, password).map_err(
                    |e| {
                        JetError::Auth(format!(
                            "password auth ({}@{addr_str}): {e}",
                            req.username
                        ))
                    },
                )?;
            }
            Credential::Key {
                private_key_path,
                passphrase,
            } => {
                let key = Path::new(private_key_path);
                if !key.exists() {
                    return Err(JetError::Auth(format!(
                        "key file not found at {}",
                        private_key_path
                    )));
                }
                session
                    .userauth_pubkey_file(&req.username, None, key, passphrase.as_deref())
                    .map_err(|e| {
                        JetError::Auth(format!(
                            "pubkey auth ({}@{addr_str}, key={}): {e}",
                            req.username, private_key_path
                        ))
                    })?;
            }
        }

        if !session.authenticated() {
            return Err(JetError::Auth(format!(
                "authentication failed for {}@{addr_str} (server refused credentials)",
                req.username
            )));
        }

        let sftp = session
            .sftp()
            .map_err(|e| JetError::Other(format!("open sftp channel: {e}")))?;
        Ok(Self {
            session,
            sftp,
            req: req.clone(),
        })
    }

    /// Open a fresh sibling connection using the same credentials. Used to
    /// spin up extra streams for parallel chunk/file transfers.
    pub fn open_clone(&self) -> JetResult<Self> {
        Self::connect(&self.req)
    }

    pub fn sftp(&self) -> &Sftp {
        &self.sftp
    }

    #[allow(dead_code)]
    pub fn session(&self) -> &Session {
        &self.session
    }

    pub fn list_dir(&self, path: &str) -> JetResult<Vec<RemoteEntry>> {
        let p = PathBuf::from(path);
        let entries = self.sftp.readdir(&p)?;
        let mut out: Vec<RemoteEntry> = entries
            .into_iter()
            .map(|(entry_path, stat)| {
                let name = entry_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                // `readdir` returns lstat (does not follow symlinks). For a
                // symlink we resolve once with `stat` so a link pointing at a
                // directory shows up as a folder in the tree/UI rather than a
                // file. Size/mtime stay from the link itself when resolution
                // fails (dangling link).
                let mut is_dir = stat.is_dir();
                let mut size = stat.size.unwrap_or(0);
                let mut modified = stat.mtime;
                if stat.file_type() == FileType::Symlink {
                    if let Ok(target) = self.sftp.stat(&entry_path) {
                        is_dir = target.is_dir();
                        size = target.size.unwrap_or(size);
                        modified = target.mtime.or(modified);
                    }
                }

                RemoteEntry {
                    name,
                    path: entry_path.to_string_lossy().into_owned(),
                    is_dir,
                    size,
                    modified,
                }
            })
            .collect();

        out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        Ok(out)
    }
}
