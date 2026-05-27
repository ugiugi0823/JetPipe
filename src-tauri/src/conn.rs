//! Connection abstraction over a remote SFTP server and the local machine's
//! filesystem. Both expose the same directory/metadata/transfer surface so
//! the rest of the app can treat "local PC" as just another endpoint.

use crate::error::JetResult;
use crate::ssh::{RemoteEntry, SshConnection};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::time::UNIX_EPOCH;

pub enum Connection {
    Local,
    Remote(SshConnection),
}

/// The local user's home directory, used as the starting path for a local
/// connection. Falls back to `/` (unix) when nothing is set.
pub fn local_home() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| "/".into())
}

impl Connection {
    pub fn is_remote(&self) -> bool {
        matches!(self, Connection::Remote(_))
    }

    /// Borrow the inner SSH connection (only valid for `Remote`).
    pub fn as_remote(&self) -> Option<&SshConnection> {
        match self {
            Connection::Remote(c) => Some(c),
            Connection::Local => None,
        }
    }

    pub fn list_dir(&self, path: &str) -> JetResult<Vec<RemoteEntry>> {
        match self {
            Connection::Remote(c) => c.list_dir(path),
            Connection::Local => local_list_dir(path),
        }
    }

    pub fn is_dir(&self, path: &str) -> JetResult<bool> {
        match self {
            Connection::Remote(c) => Ok(c.sftp().stat(Path::new(path))?.is_dir()),
            Connection::Local => Ok(fs::metadata(path)?.is_dir()),
        }
    }

    pub fn size(&self, path: &str) -> JetResult<u64> {
        match self {
            Connection::Remote(c) => Ok(c.sftp().stat(Path::new(path))?.size.unwrap_or(0)),
            Connection::Local => Ok(fs::metadata(path)?.len()),
        }
    }

    pub fn mkdir(&self, path: &str) -> JetResult<()> {
        match self {
            Connection::Remote(c) => {
                c.sftp().mkdir(Path::new(path), 0o755)?;
                Ok(())
            }
            Connection::Local => {
                fs::create_dir(path)?;
                Ok(())
            }
        }
    }

    /// Best-effort directory creation used while materializing a transfer
    /// tree — ignores "already exists" so re-runs progress.
    pub fn mkdir_best_effort(&self, path: &str) {
        match self {
            Connection::Remote(c) => {
                let _ = c.sftp().mkdir(Path::new(path), 0o755);
            }
            Connection::Local => {
                let _ = fs::create_dir_all(path);
            }
        }
    }

    pub fn rename(&self, from: &str, to: &str) -> JetResult<()> {
        match self {
            Connection::Remote(c) => {
                c.sftp().rename(Path::new(from), Path::new(to), None)?;
                Ok(())
            }
            Connection::Local => {
                fs::rename(from, to)?;
                Ok(())
            }
        }
    }

    pub fn delete(&self, path: &str) -> JetResult<()> {
        match self {
            Connection::Remote(c) => c.delete_recursive(path),
            Connection::Local => {
                // symlink_metadata so a symlink-to-dir is removed as a link.
                let meta = fs::symlink_metadata(path)?;
                if meta.is_dir() {
                    fs::remove_dir_all(path)?;
                } else {
                    fs::remove_file(path)?;
                }
                Ok(())
            }
        }
    }

    /// Remove a single file, ignoring errors. Used to clean up a partial
    /// destination after a failed/cancelled transfer.
    pub fn unlink_quiet(&self, path: &str) {
        match self {
            Connection::Remote(c) => {
                let _ = c.sftp().unlink(Path::new(path));
            }
            Connection::Local => {
                let _ = fs::remove_file(path);
            }
        }
    }

    /// Open a streaming reader for a file.
    pub fn open_reader<'a>(&'a self, path: &str) -> Result<Box<dyn Read + 'a>, String> {
        match self {
            Connection::Remote(c) => {
                let f = c
                    .sftp()
                    .open(Path::new(path))
                    .map_err(|e| format!("open src: {e}"))?;
                Ok(Box::new(f))
            }
            Connection::Local => {
                let f = fs::File::open(path).map_err(|e| format!("open src: {e}"))?;
                Ok(Box::new(f))
            }
        }
    }

    /// Open a streaming writer for a file (truncate-create).
    pub fn open_writer<'a>(&'a self, path: &str) -> Result<Box<dyn Write + 'a>, String> {
        match self {
            Connection::Remote(c) => {
                let f = c
                    .sftp()
                    .create(Path::new(path))
                    .map_err(|e| format!("create dst: {e}"))?;
                Ok(Box::new(f))
            }
            Connection::Local => {
                let f = fs::File::create(path).map_err(|e| format!("create dst: {e}"))?;
                Ok(Box::new(f))
            }
        }
    }
}

fn local_list_dir(path: &str) -> JetResult<Vec<RemoteEntry>> {
    let mut out: Vec<RemoteEntry> = Vec::new();
    for entry in fs::read_dir(path)? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        // Follow symlinks for the is_dir flag (parallels the remote side),
        // but read length/mtime from the entry's own metadata.
        let resolved_is_dir = fs::metadata(&p).map(|m| m.is_dir()).unwrap_or(false);
        let lmeta = entry.metadata().ok();
        let size = lmeta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = lmeta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        out.push(RemoteEntry {
            name,
            path: p.to_string_lossy().into_owned(),
            is_dir: resolved_is_dir,
            size,
            modified,
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

/// Walk a directory tree (local or remote), returning every dir + file with
/// mirrored destination paths. Mirrors `transfer::walk_remote_tree` but works
/// for both connection kinds.
pub struct WalkEntry {
    pub src: String,
    pub dst: String,
    pub is_dir: bool,
    pub size: u64,
}

pub fn walk_tree(conn: &Connection, src_root: &str, dst_root: &str) -> JetResult<Vec<WalkEntry>> {
    use std::collections::HashSet;
    let mut out = Vec::new();
    out.push(WalkEntry {
        src: src_root.to_string(),
        dst: dst_root.to_string(),
        is_dir: true,
        size: 0,
    });
    // Guard against symlink loops by refusing to descend into a directory
    // path we've already visited.
    let mut visited: HashSet<String> = HashSet::new();
    visited.insert(src_root.to_string());

    let mut stack = vec![(src_root.to_string(), dst_root.to_string())];
    while let Some((src_dir, dst_dir)) = stack.pop() {
        let entries = conn.list_dir(&src_dir)?;
        for e in entries {
            let dp = format!("{}/{}", dst_dir.trim_end_matches('/'), e.name);
            if e.is_dir {
                if !visited.insert(e.path.clone()) {
                    continue; // already walked this directory
                }
                out.push(WalkEntry {
                    src: e.path.clone(),
                    dst: dp.clone(),
                    is_dir: true,
                    size: 0,
                });
                stack.push((e.path, dp));
            } else {
                out.push(WalkEntry {
                    src: e.path,
                    dst: dp,
                    is_dir: false,
                    size: e.size,
                });
            }
        }
    }
    Ok(out)
}
