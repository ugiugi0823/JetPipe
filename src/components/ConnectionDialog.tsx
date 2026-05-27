import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { X, FolderKey } from "lucide-react";
import type { Credential, SavedSession } from "../types";
import { useT } from "../lib/i18n";

interface Props {
  initial?: SavedSession | null;
  onCancel: () => void;
  onSave: (s: SavedSession) => void;
}

export default function ConnectionDialog({ initial, onCancel, onSave }: Props) {
  const t = useT();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(initial?.port ?? 22);
  const [username, setUsername] = useState(initial?.username ?? "");
  const [authKind, setAuthKind] = useState<"password" | "key">(
    initial?.credential.kind ?? "key"
  );
  const [password, setPassword] = useState(
    initial?.credential.kind === "password" ? initial.credential.password : ""
  );
  const [privateKeyPath, setPrivateKeyPath] = useState(
    initial?.credential.kind === "key" ? initial.credential.privateKeyPath : ""
  );
  const [passphrase, setPassphrase] = useState(
    initial?.credential.kind === "key" ? initial.credential.passphrase ?? "" : ""
  );
  const [compression, setCompression] = useState(!!initial?.compression);

  async function pickKey() {
    const res = await openDialog({
      multiple: false,
      directory: false,
      title: "Select SSH private key",
    });
    if (typeof res === "string") setPrivateKeyPath(res);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const credential: Credential =
      authKind === "password"
        ? { kind: "password", password }
        : { kind: "key", privateKeyPath, passphrase: passphrase || undefined };

    const saved: SavedSession = {
      id: initial?.id ?? crypto.randomUUID(),
      label: label || `${username}@${host}`,
      host,
      port,
      username,
      credential,
      compression,
    };
    onSave(saved);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-[440px] bg-base border border-edge rounded-xl shadow-2xl"
      >
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-edge">
          <h2 className="text-sm font-semibold tracking-tight">
            {initial ? "Edit Session" : "New Session"}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-ink-faint hover:text-ink transition"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-5 space-y-3.5">
          <Field label="Label">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="prod-api"
              className={inputCls}
            />
          </Field>

          <div className="flex gap-3">
            <Field label="Host" className="flex-1">
              <input
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.10"
                className={inputCls}
              />
            </Field>
            <Field label="Port" className="w-24">
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value) || 22)}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Username">
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ubuntu"
              className={inputCls}
            />
          </Field>

          <div className="flex items-center gap-1.5 pt-1">
            {(["key", "password"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setAuthKind(k)}
                className={`px-2.5 py-1 rounded text-[11px] transition border ${
                  authKind === k
                    ? "border-brand/40 bg-brand/10 text-brand"
                    : "border-edge text-ink-faint hover:text-ink-muted"
                }`}
              >
                {k === "key" ? "Private Key" : "Password"}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={compression}
              onChange={(e) => setCompression(e.target.checked)}
              className="accent-brand"
            />
            <span className="text-[11px] text-ink-muted">
              {t("useCompression")}
            </span>
            <span className="text-[10px] text-ink-faint">
              {t("compressionHint")}
            </span>
          </label>

          {authKind === "password" ? (
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
            </Field>
          ) : (
            <>
              <Field label="Private key path">
                <div className="flex gap-1.5">
                  <input
                    value={privateKeyPath}
                    onChange={(e) => setPrivateKeyPath(e.target.value)}
                    placeholder="~/.ssh/id_ed25519"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={pickKey}
                    className="px-2 rounded border border-edge hover:bg-surface text-ink-muted transition"
                    title="Browse"
                  >
                    <FolderKey size={14} />
                  </button>
                </div>
              </Field>
              <Field label="Passphrase (optional)">
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </>
          )}
        </div>

        <footer className="px-5 py-3.5 border-t border-edge flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-edge text-ink-muted hover:text-ink transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs rounded bg-brand hover:bg-brand text-zinc-950 font-medium transition"
          >
            Save
          </button>
        </footer>
      </form>
    </div>
  );
}

const inputCls =
  "w-full bg-surface/60 border border-edge rounded px-2.5 py-1.5 text-xs text-ink placeholder-ink-faint outline-none focus:border-brand/50 transition";

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}
