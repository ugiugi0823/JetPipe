use crate::conn::{walk_tree, Connection};
use crate::error::{JetError, JetResult};
use crate::session::SessionStore;
use crate::ssh::SshConnection;
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use ssh2::{OpenFlags, OpenType};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::sync_channel;
use std::sync::Arc;
use std::thread;
use std::time::Instant;
use tauri::Emitter;
use uuid::Uuid;

/// A pair of (source, destination) SSH connections forming one parallel
/// transfer stream. The first entry is the original pair from the session
/// store; the rest are extras opened via `SshConnection::open_clone`.
type StreamPool = Vec<(Arc<SshConnection>, Arc<SshConnection>)>;

/// Per-chunk transfer unit. Sized to match libssh2's effective SFTP payload —
/// smaller means more round trips; larger gets fragmented inside libssh2.
const CHUNK_SIZE: usize = 256 * 1024;

/// How many read-ahead chunks the reader can stage before blocking. Larger =
/// more memory pressure + more in-flight bytes hiding latency. 12 chunks ≈ 3MB
/// of RAM per active transfer, enough to keep gigabit links saturated across
/// transcontinental SSH RTTs.
const PIPELINE_DEPTH: usize = 12;

/// Total number of parallel SSH streams to use when transferring a large file
/// or a directory of multiple files. Tuned for LLM model transfers where the
/// bottleneck is libssh2's single-session serialization — extra sessions get
/// true network-level parallelism.
const PARALLEL_STREAMS: usize = 4;

/// Files at or above this size on a single-file transfer get split into
/// `PARALLEL_STREAMS` byte ranges, each streamed over its own SSH session
/// pair. Below this, the chunked-parallel overhead (extra handshakes +
/// coordination) costs more than it saves.
const CHUNK_PARALLEL_THRESHOLD: u64 = 64 * 1024 * 1024;

#[derive(Default)]
pub struct CancelRegistry {
    inner: RwLock<HashMap<String, Arc<AtomicBool>>>,
}

impl CancelRegistry {
    pub fn new() -> Self {
        Self::default()
    }
    fn register(&self, id: &str) -> Arc<AtomicBool> {
        let token = Arc::new(AtomicBool::new(false));
        self.inner.write().insert(id.to_string(), token.clone());
        token
    }
    fn unregister(&self, id: &str) {
        self.inner.write().remove(id);
    }
    fn cancel(&self, id: &str) -> bool {
        if let Some(t) = self.inner.read().get(id) {
            t.store(true, Ordering::Relaxed);
            true
        } else {
            false
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipeRequest {
    pub job_id: String,
    pub source_session_id: String,
    pub source_path: String,
    pub dest_session_id: String,
    pub dest_path: String,
    /// Destination paths the user chose to skip (conflict resolution). Files
    /// whose dest is in this set are dropped from the plan before transfer.
    #[serde(default)]
    pub skip: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScanRequest {
    pub source_session_id: String,
    pub source_path: String,
    pub dest_session_id: String,
    pub dest_path: String,
}

/// One file that already exists at the destination. The frontend uses the
/// size/mtime pairs to drive the "overwrite if size differs / if newer"
/// conflict actions without another backend round-trip.
#[derive(Debug, Clone, Serialize)]
pub struct Conflict {
    pub rel: String,
    pub dest: String,
    pub source_size: u64,
    pub dest_size: u64,
    pub source_mtime: Option<u64>,
    pub dest_mtime: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnqueuedFile {
    pub file_id: String,
    pub rel: String,
    pub source: String,
    pub dest: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnqueueEvent {
    pub job_id: String,
    pub source_side: Option<String>,
    pub dest_side: Option<String>,
    pub files: Vec<EnqueuedFile>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileProgressEvent {
    pub job_id: String,
    pub file_id: String,
    pub bytes: u64,
    pub total: u64,
    pub bps: f64,
    /// "queued" | "active" | "done" | "failed" | "cancelled"
    pub status: &'static str,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PipeResult {
    pub job_id: String,
    pub bytes_transferred: u64,
    pub elapsed_seconds: f64,
}

fn emit_progress(app: &tauri::AppHandle, evt: FileProgressEvent) {
    let _ = app.emit("transfer:file", evt);
}

/// Copy one file from src SFTP to dst SFTP using a producer/consumer
/// pipeline: a reader thread streams chunks through a bounded RAM channel
/// to a writer running on this thread.
///
/// The previous implementation read a chunk, awaited the SFTP read ACK,
/// then wrote it and awaited the SFTP write ACK — round trips serialized
/// end-to-end. Splitting reader and writer overlaps those round trips, so
/// the two TCP pipes fill simultaneously instead of taking turns. On
/// symmetric links this approaches a 2× speedup; on asymmetric links it
/// at least removes the slower side from the critical path of the faster.
///
/// `std::thread::scope` lets us pass `&SshConnection` references into the
/// reader without `'static` bounds — the scope guarantees the spawned
/// thread joins before this function returns. Each thread opens its own
/// `ssh2::File` so we never move !Send handles across thread boundaries,
/// and src/dst sit on separate ssh2 Sessions so there's no cross-thread
/// libssh2 contention.
fn copy_file(
    app: &tauri::AppHandle,
    src: &SshConnection,
    dst: &SshConnection,
    job_id: &str,
    file: &EnqueuedFile,
    cancel_token: &Arc<AtomicBool>,
) -> Result<u64, String> {
    let job_id_s = job_id.to_string();
    let file_id_s = file.file_id.clone();
    let total = file.size;
    let src_path = file.source.clone();
    let dst_path = file.dest.clone();

    emit_progress(
        app,
        FileProgressEvent {
            job_id: job_id_s.clone(),
            file_id: file_id_s.clone(),
            bytes: 0,
            total,
            bps: 0.0,
            status: "active",
            error: None,
        },
    );

    let start = Instant::now();
    let (tx, rx) = sync_channel::<Vec<u8>>(PIPELINE_DEPTH);
    let cancel_r = Arc::clone(cancel_token);
    let cancel_w = Arc::clone(cancel_token);

    let result: Result<u64, String> = thread::scope(|s| {
        let reader_handle = s.spawn(move || -> Result<(), String> {
            let mut reader = src
                .sftp()
                .open(Path::new(&src_path))
                .map_err(|e| format!("open src: {e}"))?;
            let mut buf = vec![0u8; CHUNK_SIZE];
            loop {
                if cancel_r.load(Ordering::Relaxed) {
                    return Err("cancelled".to_string());
                }
                let n = reader
                    .read(&mut buf)
                    .map_err(|e| format!("read failed: {e}"))?;
                if n == 0 {
                    return Ok(());
                }
                // Per-chunk allocation so the writer can keep the buffer
                // while the reader fills the next one.
                let chunk = buf[..n].to_vec();
                if tx.send(chunk).is_err() {
                    return Ok(()); // writer hung up
                }
            }
        });

        // Writer stays on this scope thread so it shares `app` directly.
        let writer_outcome: Result<u64, String> = (|| {
            let mut writer = dst
                .sftp()
                .create(Path::new(&dst_path))
                .map_err(|e| format!("create dst: {e}"))?;

            let mut transferred: u64 = 0;
            let mut last_emit = Instant::now();

            while let Ok(chunk) = rx.recv() {
                if cancel_w.load(Ordering::Relaxed) {
                    return Err("cancelled".to_string());
                }
                writer
                    .write_all(&chunk)
                    .map_err(|e| format!("write failed: {e}"))?;
                transferred += chunk.len() as u64;

                if last_emit.elapsed().as_millis() >= 100 {
                    let elapsed = start.elapsed().as_secs_f64().max(0.001);
                    let bps = transferred as f64 / elapsed;
                    emit_progress(
                        app,
                        FileProgressEvent {
                            job_id: job_id_s.clone(),
                            file_id: file_id_s.clone(),
                            bytes: transferred,
                            total,
                            bps,
                            status: "active",
                            error: None,
                        },
                    );
                    last_emit = Instant::now();
                }
            }
            writer
                .flush()
                .map_err(|e| format!("flush failed: {e}"))?;
            Ok(transferred)
        })();

        let reader_outcome = reader_handle
            .join()
            .unwrap_or_else(|_| Err("reader thread panicked".to_string()));

        match (writer_outcome, reader_outcome) {
            (Err(e), _) => Err(e),
            (Ok(_), Err(e)) => Err(e),
            (Ok(n), Ok(())) => Ok(n),
        }
    });

    match result {
        Ok(transferred) => {
            let elapsed = start.elapsed().as_secs_f64().max(0.001);
            emit_progress(
                app,
                FileProgressEvent {
                    job_id: job_id.to_string(),
                    file_id: file.file_id.clone(),
                    bytes: transferred,
                    total: file.size,
                    bps: transferred as f64 / elapsed,
                    status: "done",
                    error: None,
                },
            );
            Ok(transferred)
        }
        Err(reason) => {
            let _ = dst.sftp().unlink(Path::new(&file.dest));
            let cancelled = reason == "cancelled";
            emit_progress(
                app,
                FileProgressEvent {
                    job_id: job_id.to_string(),
                    file_id: file.file_id.clone(),
                    bytes: 0,
                    total: file.size,
                    bps: 0.0,
                    status: if cancelled { "cancelled" } else { "failed" },
                    error: if cancelled { None } else { Some(reason.clone()) },
                },
            );
            Err(reason)
        }
    }
}

/// Open up to `count` connections cloned from `base` (each a fresh SSH
/// session sharing the same credentials). Best-effort: stops at the first
/// failure and returns whatever opened.
fn open_clones(base: &SshConnection, count: usize) -> Vec<Arc<SshConnection>> {
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        match base.open_clone() {
            Ok(c) => out.push(Arc::new(c)),
            Err(_) => break,
        }
    }
    out
}

/// Single-threaded buffered copy that works for ANY connection pair
/// (local↔remote, remote↔local, local↔local). Local disk I/O isn't the
/// bottleneck, so we skip the remote↔remote pipelining/chunking machinery
/// here and just stream through one RAM buffer with progress + cancel.
fn copy_file_simple(
    app: &tauri::AppHandle,
    src: &Connection,
    dst: &Connection,
    job_id: &str,
    file: &EnqueuedFile,
    cancel_token: &Arc<AtomicBool>,
) -> Result<u64, String> {
    emit_progress(
        app,
        FileProgressEvent {
            job_id: job_id.to_string(),
            file_id: file.file_id.clone(),
            bytes: 0,
            total: file.size,
            bps: 0.0,
            status: "active",
            error: None,
        },
    );

    let start = Instant::now();
    let outcome: Result<u64, String> = (|| {
        let mut reader = src.open_reader(&file.source)?;
        let mut writer = dst.open_writer(&file.dest)?;
        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut transferred: u64 = 0;
        let mut last_emit = Instant::now();
        loop {
            if cancel_token.load(Ordering::Relaxed) {
                return Err("cancelled".to_string());
            }
            let n = reader
                .read(&mut buf)
                .map_err(|e| format!("read failed: {e}"))?;
            if n == 0 {
                break;
            }
            writer
                .write_all(&buf[..n])
                .map_err(|e| format!("write failed: {e}"))?;
            transferred += n as u64;

            if last_emit.elapsed().as_millis() >= 100 {
                let elapsed = start.elapsed().as_secs_f64().max(0.001);
                emit_progress(
                    app,
                    FileProgressEvent {
                        job_id: job_id.to_string(),
                        file_id: file.file_id.clone(),
                        bytes: transferred,
                        total: file.size,
                        bps: transferred as f64 / elapsed,
                        status: "active",
                        error: None,
                    },
                );
                last_emit = Instant::now();
            }
        }
        writer.flush().map_err(|e| format!("flush failed: {e}"))?;
        Ok(transferred)
    })();

    match outcome {
        Ok(transferred) => {
            let elapsed = start.elapsed().as_secs_f64().max(0.001);
            emit_progress(
                app,
                FileProgressEvent {
                    job_id: job_id.to_string(),
                    file_id: file.file_id.clone(),
                    bytes: transferred,
                    total: file.size,
                    bps: transferred as f64 / elapsed,
                    status: "done",
                    error: None,
                },
            );
            Ok(transferred)
        }
        Err(reason) => {
            dst.unlink_quiet(&file.dest);
            let cancelled = reason == "cancelled";
            emit_progress(
                app,
                FileProgressEvent {
                    job_id: job_id.to_string(),
                    file_id: file.file_id.clone(),
                    bytes: 0,
                    total: file.size,
                    bps: 0.0,
                    status: if cancelled { "cancelled" } else { "failed" },
                    error: if cancelled { None } else { Some(reason.clone()) },
                },
            );
            Err(reason)
        }
    }
}

/// Scan which files the transfer would overwrite: walk the source, and for
/// every file whose mirrored destination path already exists, report both
/// sizes and mtimes so the UI can offer per-file conflict actions.
#[tauri::command]
pub async fn cmd_scan_conflicts(
    store: tauri::State<'_, Arc<SessionStore>>,
    req: ScanRequest,
) -> JetResult<Vec<Conflict>> {
    let src = store.get(&req.source_session_id)?;
    let dst = store.get(&req.dest_session_id)?;
    let src_is_dir = src.is_dir(&req.source_path)?;

    // (source_path, dest_path, source_size, source_mtime) for files only.
    let files: Vec<(String, String, u64, Option<u64>)> = if src_is_dir {
        walk_tree(&src, &req.source_path, &req.dest_path)?
            .into_iter()
            .filter(|e| !e.is_dir)
            .map(|e| (e.src, e.dst, e.size, e.mtime))
            .collect()
    } else {
        let (size, mtime) = src.stat_opt(&req.source_path).unwrap_or((0, None));
        vec![(
            req.source_path.clone(),
            req.dest_path.clone(),
            size,
            mtime,
        )]
    };

    let root_prefix_len = req.source_path.trim_end_matches('/').len();
    let mut conflicts = Vec::new();
    for (src_p, dst_p, src_size, src_mtime) in files {
        if let Some((dest_size, dest_mtime)) = dst.stat_opt(&dst_p) {
            let rel = if src_is_dir && src_p.len() > root_prefix_len {
                src_p[root_prefix_len..].trim_start_matches('/').to_string()
            } else {
                Path::new(&src_p)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&src_p)
                    .to_string()
            };
            conflicts.push(Conflict {
                rel,
                dest: dst_p,
                source_size: src_size,
                dest_size,
                source_mtime: src_mtime,
                dest_mtime,
            });
        }
    }
    Ok(conflicts)
}

/// Stream a file or directory tree between two endpoints (each either a
/// remote SFTP server or the local machine).
///
/// Emits `transfer:enqueue` once with the full file plan, then a stream of
/// `transfer:file` events per file (status: queued → active → done/failed).
///
/// Fast path (both endpoints remote): spins up `PARALLEL_STREAMS` extra SSH
/// sessions and uses byte-range chunk parallelism (large single file) or
/// file-level parallelism (directories), each stream pipelined.
/// Otherwise (any local endpoint): a single buffered copy per file.
#[tauri::command]
pub async fn cmd_pipe_transfer(
    app: tauri::AppHandle,
    store: tauri::State<'_, Arc<SessionStore>>,
    cancels: tauri::State<'_, Arc<CancelRegistry>>,
    req: PipeRequest,
) -> JetResult<PipeResult> {
    let job_id = req.job_id.clone();
    let cancel_token = cancels.register(&job_id);

    let src = store.get(&req.source_session_id)?;
    let dst = store.get(&req.dest_session_id)?;

    let src_path = req.source_path.clone();
    let dst_path = req.dest_path.clone();

    let src_is_dir = match src.is_dir(&src_path) {
        Ok(v) => v,
        Err(e) => {
            cancels.unregister(&job_id);
            return Err(e);
        }
    };

    let start = Instant::now();

    // Build the file plan + create the destination directory skeleton.
    let mut files: Vec<EnqueuedFile> = if src_is_dir {
        let walk = match walk_tree(&src, &src_path, &dst_path) {
            Ok(v) => v,
            Err(e) => {
                cancels.unregister(&job_id);
                return Err(e);
            }
        };
        let (dirs, mut file_entries): (Vec<_>, Vec<_>) =
            walk.into_iter().partition(|e| e.is_dir);

        // Smallest files first so progress visibly moves early.
        file_entries.sort_by_key(|e| e.size);

        // Phase 1: mkdir destination skeleton (parents-before-children
        // preserved by partition; dispatches local vs remote).
        for d in &dirs {
            dst.mkdir_best_effort(&d.dst);
        }

        let root_prefix_len = src_path.trim_end_matches('/').len();
        file_entries
            .into_iter()
            .map(|e| {
                let rel = if e.src.len() > root_prefix_len {
                    e.src[root_prefix_len..].trim_start_matches('/').to_string()
                } else {
                    e.src.clone()
                };
                EnqueuedFile {
                    file_id: Uuid::new_v4().to_string(),
                    rel,
                    source: e.src,
                    dest: e.dst,
                    size: e.size,
                }
            })
            .collect()
    } else {
        let name = Path::new(&src_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let size = src.size(&src_path).unwrap_or(0);
        vec![EnqueuedFile {
            file_id: Uuid::new_v4().to_string(),
            rel: name,
            source: src_path.clone(),
            dest: dst_path.clone(),
            size,
        }]
    };

    // Drop files the user chose to skip during conflict resolution.
    if !req.skip.is_empty() {
        let skip: std::collections::HashSet<&str> =
            req.skip.iter().map(|s| s.as_str()).collect();
        files.retain(|f| !skip.contains(f.dest.as_str()));
    }

    let _ = app.emit(
        "transfer:enqueue",
        EnqueueEvent {
            job_id: job_id.clone(),
            source_side: None,
            dest_side: None,
            files: files.clone(),
        },
    );
    for f in &files {
        emit_progress(
            &app,
            FileProgressEvent {
                job_id: job_id.clone(),
                file_id: f.file_id.clone(),
                bytes: 0,
                total: f.size,
                bps: 0.0,
                status: "queued",
                error: None,
            },
        );
    }

    let total_transferred = Arc::new(AtomicU64::new(0));
    let first_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    // Both remote → try the parallel SSH fast path. Any local endpoint, or
    // failure to open clones, falls back to a simple per-file copy.
    let both_remote = src.is_remote() && dst.is_remote();
    let total_workload: u64 = files.iter().map(|f| f.size).sum();
    let want_parallel = files.len() > 1
        || files.iter().any(|f| f.size >= CHUNK_PARALLEL_THRESHOLD)
        || total_workload >= CHUNK_PARALLEL_THRESHOLD;

    let pool: Option<StreamPool> = if both_remote {
        let src_ssh = src.as_remote().unwrap();
        let dst_ssh = dst.as_remote().unwrap();
        let n = if want_parallel { PARALLEL_STREAMS } else { 1 };
        let src_streams = open_clones(src_ssh, n);
        let dst_streams = open_clones(dst_ssh, n);
        let count = src_streams.len().min(dst_streams.len());
        if count >= 1 {
            Some(
                (0..count)
                    .map(|i| (src_streams[i].clone(), dst_streams[i].clone()))
                    .collect(),
            )
        } else {
            None // clone failed entirely → simple path on the originals
        }
    } else {
        None
    };

    match &pool {
        Some(pool)
            if files.len() == 1
                && pool.len() > 1
                && files[0].size >= CHUNK_PARALLEL_THRESHOLD =>
        {
            // Single large file: byte-range chunk parallelism.
            match copy_file_chunked(&app, pool, &job_id, &files[0], &cancel_token) {
                Ok(n) => {
                    total_transferred.fetch_add(n, Ordering::Relaxed);
                }
                Err(e) => *first_error.lock() = Some(e),
            }
        }
        Some(pool) if pool.len() > 1 && files.len() > 1 => {
            // Directory: worker pool drains a shared queue (smallest first).
            let mut queue_vec = files.clone();
            queue_vec.reverse();
            let queue = Arc::new(Mutex::new(queue_vec));
            thread::scope(|s| {
                for (src_p, dst_p) in pool.iter() {
                    let queue = Arc::clone(&queue);
                    let total_transferred = Arc::clone(&total_transferred);
                    let first_error = Arc::clone(&first_error);
                    let app_ref = &app;
                    let job_id_ref = &job_id;
                    let cancel_ref = &cancel_token;
                    let src_w = Arc::clone(src_p);
                    let dst_w = Arc::clone(dst_p);
                    s.spawn(move || loop {
                        if cancel_ref.load(Ordering::Relaxed) {
                            return;
                        }
                        let f = match queue.lock().pop() {
                            Some(v) => v,
                            None => return,
                        };
                        match copy_file(app_ref, &src_w, &dst_w, job_id_ref, &f, cancel_ref) {
                            Ok(n) => {
                                total_transferred.fetch_add(n, Ordering::Relaxed);
                            }
                            Err(reason) => {
                                let mut err = first_error.lock();
                                if err.is_none() {
                                    *err = Some(reason);
                                }
                            }
                        }
                    });
                }
            });
        }
        Some(pool) => {
            // Remote↔remote single small file: one pipelined stream.
            for f in &files {
                if cancel_token.load(Ordering::Relaxed) {
                    mark_cancelled(&app, &job_id, f);
                    continue;
                }
                match copy_file(&app, &pool[0].0, &pool[0].1, &job_id, f, &cancel_token) {
                    Ok(n) => {
                        total_transferred.fetch_add(n, Ordering::Relaxed);
                    }
                    Err(reason) => {
                        let mut err = first_error.lock();
                        if err.is_none() {
                            *err = Some(reason);
                        }
                    }
                }
            }
        }
        None => {
            // Any local endpoint (or clone failure): simple buffered copy,
            // smallest first.
            let mut ordered = files.clone();
            ordered.sort_by_key(|f| f.size);
            for f in &ordered {
                if cancel_token.load(Ordering::Relaxed) {
                    mark_cancelled(&app, &job_id, f);
                    continue;
                }
                match copy_file_simple(&app, &src, &dst, &job_id, f, &cancel_token) {
                    Ok(n) => {
                        total_transferred.fetch_add(n, Ordering::Relaxed);
                    }
                    Err(reason) => {
                        let mut err = first_error.lock();
                        if err.is_none() {
                            *err = Some(reason);
                        }
                    }
                }
            }
        }
    }

    cancels.unregister(&job_id);
    let elapsed = start.elapsed().as_secs_f64();
    let total = total_transferred.load(Ordering::Relaxed);

    let final_err = first_error.lock().take();
    if let Some(err) = final_err {
        Err(JetError::Other(err))
    } else {
        Ok(PipeResult {
            job_id,
            bytes_transferred: total,
            elapsed_seconds: elapsed,
        })
    }
}

fn mark_cancelled(app: &tauri::AppHandle, job_id: &str, f: &EnqueuedFile) {
    emit_progress(
        app,
        FileProgressEvent {
            job_id: job_id.to_string(),
            file_id: f.file_id.clone(),
            bytes: 0,
            total: f.size,
            bps: 0.0,
            status: "cancelled",
            error: None,
        },
    );
}

/// Byte-range chunk parallel transfer of a single large file across an
/// already-built `StreamPool`. The destination is truncate-created once,
/// then each worker opens its own write handle, seeks to its range start,
/// and streams its slice using the same read/write pipeline as `copy_file`.
///
/// Why this works: SFTP servers expose offset-based reads/writes via
/// handles, and modern servers (OpenSSH, ProFTPD, vsftpd) accept multiple
/// concurrent write handles on a single file as long as their offsets don't
/// overlap — which is true by construction here. Each (src,dst) pair sits
/// on its own SSH session, so libssh2's session mutex doesn't serialize
/// across workers like it would on a single session.
fn copy_file_chunked(
    app: &tauri::AppHandle,
    pool: &StreamPool,
    job_id: &str,
    file: &EnqueuedFile,
    cancel_token: &Arc<AtomicBool>,
) -> Result<u64, String> {
    emit_progress(
        app,
        FileProgressEvent {
            job_id: job_id.to_string(),
            file_id: file.file_id.clone(),
            bytes: 0,
            total: file.size,
            bps: 0.0,
            status: "active",
            error: None,
        },
    );

    // Step 1: truncate-create destination using the first dst session. All
    // workers will then re-open the existing file with WRITE only.
    pool[0]
        .1
        .sftp()
        .open_mode(
            Path::new(&file.dest),
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
            0o644,
            OpenType::File,
        )
        .map_err(|e| format!("create dst: {e}"))?;

    let n = pool.len();
    let range_size = file.size.div_ceil(n as u64).max(1);

    let total_done = Arc::new(AtomicU64::new(0));
    let first_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let start = Instant::now();
    let last_emit = Arc::new(Mutex::new(Instant::now()));

    let _ = thread::scope(|s| -> Result<(), ()> {
        let mut handles = Vec::with_capacity(n);
        for (i, (src_w, dst_w)) in pool.iter().enumerate() {
            let start_off = i as u64 * range_size;
            if start_off >= file.size {
                continue;
            }
            let end_off = ((i as u64 + 1) * range_size).min(file.size);
            let total_done = Arc::clone(&total_done);
            let first_error = Arc::clone(&first_error);
            let last_emit = Arc::clone(&last_emit);
            let cancel = Arc::clone(cancel_token);
            let src_path = file.source.clone();
            let dst_path = file.dest.clone();
            let job_id_s = job_id.to_string();
            let file_id_s = file.file_id.clone();
            let total = file.size;
            let src_w = Arc::clone(src_w);
            let dst_w = Arc::clone(dst_w);

            handles.push(s.spawn(move || {
                let res: Result<(), String> = (|| {
                    let mut reader = src_w
                        .sftp()
                        .open(Path::new(&src_path))
                        .map_err(|e| format!("worker {i} open src: {e}"))?;
                    reader
                        .seek(SeekFrom::Start(start_off))
                        .map_err(|e| format!("worker {i} seek src: {e}"))?;

                    let mut writer = dst_w
                        .sftp()
                        .open_mode(
                            Path::new(&dst_path),
                            OpenFlags::WRITE,
                            0o644,
                            OpenType::File,
                        )
                        .map_err(|e| format!("worker {i} open dst: {e}"))?;
                    writer
                        .seek(SeekFrom::Start(start_off))
                        .map_err(|e| format!("worker {i} seek dst: {e}"))?;

                    let mut remaining = end_off - start_off;
                    let mut buf = vec![0u8; CHUNK_SIZE];

                    while remaining > 0 {
                        if cancel.load(Ordering::Relaxed) {
                            return Err("cancelled".to_string());
                        }
                        let want = (remaining as usize).min(CHUNK_SIZE);
                        let n_read = reader
                            .read(&mut buf[..want])
                            .map_err(|e| format!("worker {i} read: {e}"))?;
                        if n_read == 0 {
                            break;
                        }
                        writer
                            .write_all(&buf[..n_read])
                            .map_err(|e| format!("worker {i} write: {e}"))?;
                        remaining = remaining.saturating_sub(n_read as u64);

                        let done =
                            total_done.fetch_add(n_read as u64, Ordering::Relaxed)
                                + n_read as u64;

                        let mut le = last_emit.lock();
                        if le.elapsed().as_millis() >= 100 {
                            *le = Instant::now();
                            let elapsed = start.elapsed().as_secs_f64().max(0.001);
                            let bps = done as f64 / elapsed;
                            drop(le);
                            emit_progress(
                                app,
                                FileProgressEvent {
                                    job_id: job_id_s.clone(),
                                    file_id: file_id_s.clone(),
                                    bytes: done,
                                    total,
                                    bps,
                                    status: "active",
                                    error: None,
                                },
                            );
                        }
                    }
                    writer
                        .flush()
                        .map_err(|e| format!("worker {i} flush: {e}"))?;
                    Ok(())
                })();

                if let Err(e) = res {
                    let mut err = first_error.lock();
                    if err.is_none() {
                        *err = Some(e);
                    }
                }
            }));
        }

        for h in handles {
            let _ = h.join();
        }
        Ok(())
    });

    let done = total_done.load(Ordering::Relaxed);
    if let Some(err) = first_error.lock().take() {
        // Best-effort cleanup of the partial file.
        let _ = pool[0].1.sftp().unlink(Path::new(&file.dest));
        let cancelled = err == "cancelled";
        emit_progress(
            app,
            FileProgressEvent {
                job_id: job_id.to_string(),
                file_id: file.file_id.clone(),
                bytes: 0,
                total: file.size,
                bps: 0.0,
                status: if cancelled { "cancelled" } else { "failed" },
                error: if cancelled { None } else { Some(err.clone()) },
            },
        );
        return Err(err);
    }

    let elapsed = start.elapsed().as_secs_f64().max(0.001);
    emit_progress(
        app,
        FileProgressEvent {
            job_id: job_id.to_string(),
            file_id: file.file_id.clone(),
            bytes: done,
            total: file.size,
            bps: done as f64 / elapsed,
            status: "done",
            error: None,
        },
    );
    Ok(done)
}

#[tauri::command]
pub fn cmd_cancel_transfer(
    cancels: tauri::State<'_, Arc<CancelRegistry>>,
    job_id: String,
) -> JetResult<bool> {
    Ok(cancels.cancel(&job_id))
}

#[derive(Debug, Clone, Serialize)]
pub struct SpeedResult {
    pub bytes: u64,
    pub upload_bps: f64,
    pub download_bps: f64,
}

/// Round-trip throughput test for a connection: write a temp file of
/// `size_mb` (measures upload), read it back (measures download), then
/// delete it. Single-stream — a fair "how fast is this link" number,
/// independent of the parallel/chunked transfer machinery.
#[tauri::command]
pub async fn cmd_speedtest(
    store: tauri::State<'_, Arc<SessionStore>>,
    id: String,
    home: String,
    size_mb: Option<u64>,
) -> JetResult<SpeedResult> {
    let conn = store.get(&id)?;
    let size = size_mb.unwrap_or(32).clamp(1, 1024) * 1024 * 1024;
    let test_path = format!("{}/.jetpipe_speedtest.tmp", home.trim_end_matches('/'));
    let chunk = vec![0u8; CHUNK_SIZE];

    // Upload phase.
    let up_start = Instant::now();
    {
        let mut writer = conn
            .open_writer(&test_path)
            .map_err(JetError::Other)?;
        let mut remaining = size;
        while remaining > 0 {
            let n = (remaining as usize).min(CHUNK_SIZE);
            writer
                .write_all(&chunk[..n])
                .map_err(|e| JetError::Other(format!("speedtest write: {e}")))?;
            remaining -= n as u64;
        }
        writer
            .flush()
            .map_err(|e| JetError::Other(format!("speedtest flush: {e}")))?;
    }
    let up_secs = up_start.elapsed().as_secs_f64().max(0.001);

    // Download phase.
    let down_start = Instant::now();
    {
        let mut reader = conn
            .open_reader(&test_path)
            .map_err(JetError::Other)?;
        let mut buf = vec![0u8; CHUNK_SIZE];
        loop {
            let n = reader
                .read(&mut buf)
                .map_err(|e| JetError::Other(format!("speedtest read: {e}")))?;
            if n == 0 {
                break;
            }
        }
    }
    let down_secs = down_start.elapsed().as_secs_f64().max(0.001);

    conn.unlink_quiet(&test_path);

    Ok(SpeedResult {
        bytes: size,
        upload_bps: size as f64 / up_secs,
        download_bps: size as f64 / down_secs,
    })
}
