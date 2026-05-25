import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Credential,
  LiveSession,
  QueueEntry,
  RemoteEntry,
  TransferStatus,
} from "../types";

type RustEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number | null;
};

type RustEnqueuedFile = {
  file_id: string;
  rel: string;
  source: string;
  dest: string;
  size: number;
};

type RustEnqueue = {
  job_id: string;
  source_side: string | null;
  dest_side: string | null;
  files: RustEnqueuedFile[];
};

type RustFileProgress = {
  job_id: string;
  file_id: string;
  bytes: number;
  total: number;
  bps: number;
  status: TransferStatus;
  error: string | null;
};

function mapCredential(c: Credential) {
  if (c.kind === "password") return { kind: "password", password: c.password };
  return {
    kind: "key",
    private_key_path: c.privateKeyPath,
    passphrase: c.passphrase ?? null,
  };
}

export async function connect(args: {
  host: string;
  port: number;
  username: string;
  credential: Credential;
  compression?: boolean;
}): Promise<LiveSession> {
  return invoke<LiveSession>("cmd_connect", {
    req: {
      host: args.host,
      port: args.port,
      username: args.username,
      credential: mapCredential(args.credential),
      compression: !!args.compression,
    },
  });
}

export async function disconnect(id: string): Promise<void> {
  await invoke("cmd_disconnect", { id });
}

export async function mkdir(id: string, path: string): Promise<void> {
  await invoke("cmd_mkdir", { id, path });
}

export async function renamePath(
  id: string,
  from: string,
  to: string
): Promise<void> {
  await invoke("cmd_rename", { id, from, to });
}

export async function deletePath(id: string, path: string): Promise<void> {
  await invoke("cmd_delete", { id, path });
}

export async function listDir(id: string, path: string): Promise<RemoteEntry[]> {
  const rows = await invoke<RustEntry[]>("cmd_list_dir", { id, path });
  return rows.map((r) => ({
    name: r.name,
    path: r.path,
    isDir: r.is_dir,
    size: r.size,
    modified: r.modified,
  }));
}

export async function pipeTransfer(args: {
  jobId: string;
  sourceSessionId: string;
  sourcePath: string;
  destSessionId: string;
  destPath: string;
}) {
  return invoke("cmd_pipe_transfer", {
    req: {
      job_id: args.jobId,
      source_session_id: args.sourceSessionId,
      source_path: args.sourcePath,
      dest_session_id: args.destSessionId,
      dest_path: args.destPath,
    },
  });
}

export async function cancelTransfer(jobId: string): Promise<boolean> {
  return invoke<boolean>("cmd_cancel_transfer", { jobId });
}

export type EnqueueHandler = (jobId: string, files: QueueEntry[]) => void;
export type FileProgressHandler = (p: {
  jobId: string;
  fileId: string;
  bytes: number;
  total: number;
  bps: number;
  status: TransferStatus;
  error?: string;
}) => void;

export async function onEnqueue(
  handler: EnqueueHandler
): Promise<UnlistenFn> {
  return listen<RustEnqueue>("transfer:enqueue", (e) => {
    const files: QueueEntry[] = e.payload.files.map((f) => ({
      jobId: e.payload.job_id,
      fileId: f.file_id,
      rel: f.rel,
      source: f.source,
      dest: f.dest,
      size: f.size,
      bytes: 0,
      bps: 0,
      status: "queued" as const,
    }));
    handler(e.payload.job_id, files);
  });
}

export async function onFileProgress(
  handler: FileProgressHandler
): Promise<UnlistenFn> {
  return listen<RustFileProgress>("transfer:file", (e) => {
    handler({
      jobId: e.payload.job_id,
      fileId: e.payload.file_id,
      bytes: e.payload.bytes,
      total: e.payload.total,
      bps: e.payload.bps,
      status: e.payload.status,
      error: e.payload.error ?? undefined,
    });
  });
}

// ─── OS Keychain bridge ──────────────────────────────────────────────────────

export async function keychainSet(account: string, secret: string): Promise<void> {
  await invoke("cmd_keychain_set", { account, secret });
}

export async function keychainGet(account: string): Promise<string | null> {
  return invoke<string | null>("cmd_keychain_get", { account });
}

export async function keychainDelete(account: string): Promise<void> {
  await invoke("cmd_keychain_delete", { account });
}
