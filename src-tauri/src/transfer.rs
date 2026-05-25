use crate::error::{JetError, JetResult};
use crate::session::SessionStore;
use crate::ssh::SshConnection;
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use ssh2::{FileType, OpenFlags, OpenType};
use std::collections::{HashMap, HashSet};
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

#[derive(Debug, Clone)]
struct WalkEntry {
    src: String,
    dst: String,
    is_dir: bool,
    size: u64,
}

fn walk_remote_tree(
    conn: &SshConnection,
    src_root: &str,
    dst_root: &str,
) -> JetResult<Vec<WalkEntry>> {
    let mut out = Vec::new();
    let mut queue: Vec<(String, String)> = vec![(src_root.to_string(), dst_root.to_string())];
    // Guard against symlink loops: track canonical paths we've already
    // descended into (via `realpath`) and refuse to enter them twice.
    let mut visited: HashSet<String> = HashSet::new();
    if let Ok(rp) = conn.sftp().realpath(Path::new(src_root)) {
        visited.insert(rp.to_string_lossy().into_owned());
    }

    out.push(WalkEntry {
        src: src_root.to_string(),
        dst: dst_root.to_string(),
        is_dir: true,
        size: 0,
    });

    while let Some((src_dir, dst_dir)) = queue.pop() {
        let entries = conn.sftp().readdir(Path::new(&src_dir))?;
        for (path, stat) in entries {
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) if n != "." && n != ".." => n.to_string(),
                _ => continue,
            };
            let sp = path.to_string_lossy().into_owned();
            let dp = format!("{}/{}", dst_dir.trim_end_matches('/'), name);

            // Resolve symlinks so link-to-dir is treated as a directory and
            // link-to-file flows through the file branch with the target's
            // real size. Failures leave the lstat result untouched (dangling
            // links surface later as "open src" errors and get skipped).
            let mut is_dir = stat.is_dir();
            let mut size = stat.size.unwrap_or(0);
            if stat.file_type() == FileType::Symlink {
                if let Ok(target) = conn.sftp().stat(&path) {
                    is_dir = target.is_dir();
                    size = target.size.unwrap_or(size);
                }
            }

            if is_dir {
                // Avoid descending into a symlink loop.
                let canonical = conn
                    .sftp()
                    .realpath(Path::new(&sp))
                    .ok()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_else(|| sp.clone());
                if !visited.insert(canonical) {
                    continue; // already visited via another path
                }
                out.push(WalkEntry {
                    src: sp.clone(),
                    dst: dp.clone(),
                    is_dir: true,
                    size: 0,
                });
                queue.push((sp, dp));
            } else {
                out.push(WalkEntry {
                    src: sp,
                    dst: dp,
                    is_dir: false,
                    size,
                });
            }
        }
    }
    Ok(out)
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

/// Open up to `extra_count` additional connections cloned from `base`.
/// Best-effort: stops early if a clone fails (returns whatever we got).
fn open_extras(base: &Arc<SshConnection>, extra_count: usize) -> Vec<Arc<SshConnection>> {
    let mut out = Vec::with_capacity(extra_count);
    for _ in 0..extra_count {
        match base.open_clone() {
            Ok(c) => out.push(Arc::new(c)),
            Err(_) => break,
        }
    }
    out
}

/// Build a balanced pool: same-length src/dst stream pairs.
fn build_pool(
    src: &Arc<SshConnection>,
    dst: &Arc<SshConnection>,
    desired: usize,
) -> StreamPool {
    let extras = desired.saturating_sub(1);
    let src_extras = open_extras(src, extras);
    let dst_extras = open_extras(dst, extras);
    let n = 1 + src_extras.len().min(dst_extras.len());
    let mut pool: StreamPool = vec![(Arc::clone(src), Arc::clone(dst))];
    for i in 0..(n - 1) {
        pool.push((src_extras[i].clone(), dst_extras[i].clone()));
    }
    pool
}

/// Stream a file or directory tree from one SFTP server to another.
///
/// Emits `transfer:enqueue` once with the full file plan, then a stream of
/// `transfer:file` events per file (status: queued → active → done/failed).
///
/// Spawns up to `PARALLEL_STREAMS` extra SSH connections per side and uses
/// them to parallelize:
///   - directory transfers: file-level parallelism (workers pull from queue)
///   - large single files: byte-range chunk parallelism within the file
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

    let src_stat = match src.sftp().stat(Path::new(&src_path)) {
        Ok(s) => s,
        Err(e) => {
            cancels.unregister(&job_id);
            return Err(JetError::Ssh(e));
        }
    };

    let start = Instant::now();

    // Build the file plan + create destination directory structure.
    let files: Vec<EnqueuedFile> = if src_stat.is_dir() {
        let walk = match walk_remote_tree(&src, &src_path, &dst_path) {
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
        // preserved by partition).
        for d in &dirs {
            let _ = dst.sftp().mkdir(Path::new(&d.dst), 0o755);
        }

        let root_prefix_len = src_path.trim_end_matches('/').len();
        file_entries
            .into_iter()
            .map(|e| {
                let rel = if e.src.len() > root_prefix_len {
                    e.src[root_prefix_len..]
                        .trim_start_matches('/')
                        .to_string()
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
        vec![EnqueuedFile {
            file_id: Uuid::new_v4().to_string(),
            rel: name,
            source: src_path.clone(),
            dest: dst_path.clone(),
            size: src_stat.size.unwrap_or(0),
        }]
    };

    // Emit the full plan upfront so the UI can show queued rows immediately.
    let _ = app.emit(
        "transfer:enqueue",
        EnqueueEvent {
            job_id: job_id.clone(),
            source_side: None,
            dest_side: None,
            files: files.clone(),
        },
    );

    // Emit one "queued" event per file so the UI can render them even if it
    // missed the enqueue burst due to a render delay.
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

    // Decide whether to spin up extras based on the workload. Tiny jobs
    // would just eat handshake latency, so keep them on the single pair.
    let total_workload: u64 = files.iter().map(|f| f.size).sum();
    let want_parallel = files.len() > 1
        || files.iter().any(|f| f.size >= CHUNK_PARALLEL_THRESHOLD)
        || total_workload >= CHUNK_PARALLEL_THRESHOLD;
    let pool: StreamPool = if want_parallel {
        build_pool(&src, &dst, PARALLEL_STREAMS)
    } else {
        vec![(Arc::clone(&src), Arc::clone(&dst))]
    };

    let total_transferred = Arc::new(AtomicU64::new(0));
    let first_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    if files.len() == 1 && pool.len() > 1 && files[0].size >= CHUNK_PARALLEL_THRESHOLD
    {
        // Single large file: byte-range chunk parallelism across the pool.
        let f = &files[0];
        match copy_file_chunked(&app, &pool, &job_id, f, &cancel_token) {
            Ok(n) => {
                total_transferred.fetch_add(n, Ordering::Relaxed);
            }
            Err(e) => {
                *first_error.lock() = Some(e);
            }
        }
    } else if pool.len() > 1 && files.len() > 1 {
        // Directory (multi-file): worker pool drains a shared queue.
        // Files are sorted smallest→largest, but `Vec::pop()` returns the
        // last element. Reversing here puts the smallest file at the back
        // so workers grab them first — quick wins land in the queue UI fast
        // and the big files get the tail end where partial-cancel hurts least.
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
                    let next = queue.lock().pop();
                    let f = match next {
                        Some(v) => v,
                        None => return,
                    };
                    match copy_file(
                        app_ref,
                        &src_w,
                        &dst_w,
                        job_id_ref,
                        &f,
                        cancel_ref,
                    ) {
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
    } else {
        // Single small file (or pool of size 1): existing pipelined copy.
        for f in &files {
            if cancel_token.load(Ordering::Relaxed) {
                emit_progress(
                    &app,
                    FileProgressEvent {
                        job_id: job_id.clone(),
                        file_id: f.file_id.clone(),
                        bytes: 0,
                        total: f.size,
                        bps: 0.0,
                        status: "cancelled",
                        error: None,
                    },
                );
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
