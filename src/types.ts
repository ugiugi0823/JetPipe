export type Credential =
  | { kind: "password"; password: string }
  | { kind: "key"; privateKeyPath: string; passphrase?: string };

export interface SavedSession {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  credential: Credential;
  /** Enable SSH zlib compression. Helps text/source files, neutral or
   * slightly negative for pre-compressed binaries (mp4, gz, .safetensors,
   * .pt). Default false. */
  compression?: boolean;
}

export interface LiveSession {
  id: string;
  host: string;
  port: number;
  username: string;
  home: string;
  /** "remote" | "local" */
  kind?: string;
}

export interface RemoteEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number | null;
}

export interface Conflict {
  rel: string;
  dest: string;
  sourceSize: number;
  destSize: number;
  sourceMtime: number | null;
  destMtime: number | null;
}

export type PanelSide = "left" | "right";

export type TransferStatus =
  | "queued"
  | "active"
  | "done"
  | "failed"
  | "cancelled";

export interface QueueEntry {
  jobId: string;
  fileId: string;
  rel: string;
  source: string;
  dest: string;
  size: number;
  bytes: number;
  bps: number;
  status: TransferStatus;
  error?: string;
  sourceSide?: PanelSide;
  destSide?: PanelSide;
  /** "local" | "remote" — used to render upload/download direction. */
  sourceKind?: string;
  destKind?: string;
}
