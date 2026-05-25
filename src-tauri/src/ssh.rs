use crate::error::{JetError, JetResult};
use serde::{Deserialize, Serialize};
use ssh2::{FileType, MethodType, Session, Sftp};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

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
        let addr = format!("{}:{}", req.host, req.port);
        let tcp = TcpStream::connect(&addr)
            .map_err(|e| JetError::Other(format!("tcp connect to {addr}: {e}")))?;
        // Long banner/handshake timeouts: some servers stall briefly during
        // first connection from a new client, especially behind firewalls or
        // when running rate-limited (fail2ban etc.).
        tcp.set_read_timeout(Some(Duration::from_secs(60)))?;
        tcp.set_write_timeout(Some(Duration::from_secs(60)))?;

        let mut session = Session::new()?;
        session.set_tcp_stream(tcp);

        // Explicit algorithm preferences. libssh2's defaults can be too narrow
        // depending on the bundled build (notably on Windows), causing the
        // handshake to fail against servers that still rely on widely-used
        // legacy algorithms (e.g. ssh-rsa with SHA-1 host keys). We list the
        // common modern algorithms first and keep legacy options as fallback
        // so a plain `ssh user@host` and JetPipe see the same algorithm set.
        let _ = session.method_pref(
            MethodType::HostKey,
            "ssh-ed25519,ecdsa-sha2-nistp256,ecdsa-sha2-nistp384,ecdsa-sha2-nistp521,\
             rsa-sha2-512,rsa-sha2-256,ssh-rsa,ssh-dss",
        );
        let _ = session.method_pref(
            MethodType::Kex,
            "curve25519-sha256,curve25519-sha256@libssh.org,\
             ecdh-sha2-nistp256,ecdh-sha2-nistp384,ecdh-sha2-nistp521,\
             diffie-hellman-group-exchange-sha256,\
             diffie-hellman-group16-sha512,diffie-hellman-group18-sha512,\
             diffie-hellman-group14-sha256,diffie-hellman-group14-sha1",
        );
        let _ = session.method_pref(
            MethodType::CryptCs,
            "chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,\
             aes256-ctr,aes192-ctr,aes128-ctr",
        );
        let _ = session.method_pref(
            MethodType::CryptSc,
            "chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,\
             aes256-ctr,aes192-ctr,aes128-ctr",
        );
        let _ = session.method_pref(
            MethodType::MacCs,
            "hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,\
             hmac-sha2-512,hmac-sha2-256,hmac-sha1",
        );
        let _ = session.method_pref(
            MethodType::MacSc,
            "hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,\
             hmac-sha2-512,hmac-sha2-256,hmac-sha1",
        );

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
            .map_err(|e| JetError::Other(format!("handshake with {addr}: {e}")))?;

        match &req.credential {
            Credential::Password { password } => {
                session.userauth_password(&req.username, password).map_err(
                    |e| {
                        JetError::Auth(format!(
                            "password auth ({}@{addr}): {e}",
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
                            "pubkey auth ({}@{addr}, key={}): {e}",
                            req.username, private_key_path
                        ))
                    })?;
            }
        }

        if !session.authenticated() {
            return Err(JetError::Auth(format!(
                "authentication failed for {}@{addr} (server refused credentials)",
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
