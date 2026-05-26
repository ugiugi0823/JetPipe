import { useEffect, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Pencil,
} from "lucide-react";
import { listDir } from "../lib/api";
import type { LiveSession, PanelSide } from "../types";
import { cn, joinPath } from "../lib/utils";

interface TreeNode {
  path: string;
  name: string;
  loaded: boolean;
  loading: boolean;
  children: TreeNode[];
  error?: string;
}

interface Props {
  side: PanelSide;
  session: LiveSession | null;
  selected: string;
  refreshTick?: number;
  onSelect: (path: string) => void;
  onRename?: (path: string, currentName: string) => void;
  onContextMenuEntry?: (
    e: React.MouseEvent,
    path: string,
    name: string,
    isDir: boolean
  ) => void;
  onDropToFolder?: (destDir: string, payload: string) => void;
  onDragStartFolder: (path: string, name: string) => void;
}

function readDragPayload(dt: DataTransfer): string | null {
  const custom = dt.getData("application/jetpipe");
  if (custom) return custom;
  const text = dt.getData("text/plain");
  if (text.startsWith("jetpipe:")) return text.slice("jetpipe:".length);
  return (
    (window as unknown as { __jetpipeDrag?: string }).__jetpipeDrag ?? null
  );
}

function makeNode(path: string, name: string): TreeNode {
  return { path, name, loaded: false, loading: false, children: [] };
}

export default function TreeView({
  side,
  session,
  selected,
  refreshTick,
  onSelect,
  onRename,
  onContextMenuEntry,
  onDropToFolder,
  onDragStartFolder,
}: Props) {
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setRoot(null);
      setExpanded(new Set());
      return;
    }
    const rootNode = makeNode("/", "/");
    setRoot(rootNode);
    setExpanded(new Set(["/"]));
    loadChildren(rootNode).then((updated) => setRoot({ ...updated }));
  }, [session?.id]);

  async function loadChildren(node: TreeNode): Promise<TreeNode> {
    if (!session) return node;
    node.loading = true;
    try {
      const rows = await listDir(session.id, node.path);
      node.children = rows
        .filter((r) => r.isDir)
        .map((r) => makeNode(r.path, r.name));
      node.loaded = true;
      node.error = undefined;
    } catch (e: any) {
      node.error = String(e?.message ?? e);
      node.children = [];
      node.loaded = true;
    } finally {
      node.loading = false;
    }
    return node;
  }

  async function toggle(node: TreeNode) {
    const next = new Set(expanded);
    if (next.has(node.path)) {
      next.delete(node.path);
      setExpanded(next);
      return;
    }
    next.add(node.path);
    setExpanded(next);
    if (!node.loaded) {
      await loadChildren(node);
      // Re-shape root so React picks up the change.
      if (root) setRoot({ ...root });
    }
  }

  async function handleSelect(node: TreeNode) {
    onSelect(node.path);
    // Auto-expand on select so children are visible.
    if (!expanded.has(node.path)) {
      const next = new Set(expanded);
      next.add(node.path);
      setExpanded(next);
      if (!node.loaded) {
        await loadChildren(node);
        if (root) setRoot({ ...root });
      }
    }
  }

  function renderNode(node: TreeNode, depth: number): JSX.Element {
    const isExpanded = expanded.has(node.path);
    const isSelected = node.path === selected;
    return (
      <div key={node.path}>
        <div
          draggable={node.path !== "/"}
          onDragStart={(e) => {
            if (node.path === "/") {
              e.preventDefault();
              return;
            }
            onDragStartFolder(node.path, node.name);
            const payload = JSON.stringify({
              sessionId: session?.id,
              path: node.path,
              name: node.name,
              isDir: true,
              side,
            });
            e.dataTransfer.setData("application/jetpipe", payload);
            e.dataTransfer.setData("text/plain", `jetpipe:${payload}`);
            e.dataTransfer.effectAllowed = "copy";
            (window as unknown as { __jetpipeDrag?: string }).__jetpipeDrag =
              payload;
          }}
          onClick={() => handleSelect(node)}
          onContextMenu={(e) => {
            if (node.path === "/") return; // root → bubble to panel-level "new folder"
            onContextMenuEntry?.(e, node.path, node.name, true);
          }}
          onDragOver={(e) => {
            if (!onDropToFolder) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            if (dragOverPath !== node.path) setDragOverPath(node.path);
          }}
          onDragLeave={(e) => {
            e.stopPropagation();
            if (dragOverPath === node.path) setDragOverPath(null);
          }}
          onDrop={(e) => {
            if (!onDropToFolder) return;
            e.preventDefault();
            e.stopPropagation();
            const raw = readDragPayload(e.dataTransfer);
            setDragOverPath(null);
            if (raw) onDropToFolder(node.path, raw);
          }}
          className={cn(
            "group flex items-center gap-1 px-1 py-0.5 text-xs cursor-pointer select-none transition rounded",
            dragOverPath === node.path
              ? "bg-brand/25 text-brand ring-1 ring-inset ring-brand/50"
              : isSelected
              ? "bg-brand/15 text-brand"
              : "hover:bg-zinc-900/60 text-zinc-300"
          )}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggle(node);
            }}
            className="w-3.5 h-3.5 flex items-center justify-center shrink-0 text-zinc-500 hover:text-zinc-200"
          >
            {node.children.length > 0 || !node.loaded ? (
              isExpanded ? (
                <ChevronDown size={11} />
              ) : (
                <ChevronRight size={11} />
              )
            ) : (
              <span className="w-3" />
            )}
          </button>
          {isExpanded ? (
            <FolderOpen size={12} className="text-amber-400/80 shrink-0" />
          ) : (
            <Folder size={12} className="text-amber-400/80 shrink-0" />
          )}
          <span className="flex-1 truncate">{node.name}</span>
          {onRename && node.path !== "/" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRename(node.path, node.name);
              }}
              className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-brand shrink-0 transition"
              title="이름 변경"
            >
              <Pencil size={10} />
            </button>
          )}
        </div>
        {isExpanded &&
          node.children.map((c) => renderNode(c, depth + 1))}
        {isExpanded && node.error && (
          <div
            className="text-[10px] text-rose-400/80 px-2 py-0.5 truncate"
            style={{ paddingLeft: 4 + (depth + 1) * 14 }}
          >
            {node.error}
          </div>
        )}
      </div>
    );
  }

  // Reload children of every expanded loaded node when refreshTick changes.
  // Preserves the user's expand state across mkdir/rename operations.
  useEffect(() => {
    if (!root || !session || refreshTick === undefined) return;
    async function reloadExpanded() {
      if (!root) return;
      const stack: TreeNode[] = [root];
      while (stack.length) {
        const node = stack.pop()!;
        if (expanded.has(node.path) && node.loaded) {
          await loadChildren(node);
          stack.push(...node.children);
        } else if (node.loaded) {
          // Recurse into already-loaded subtrees in case they have expanded
          // descendants further down.
          stack.push(...node.children);
        }
      }
      setRoot({ ...root });
    }
    reloadExpanded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  // Ensure the currently selected path is loaded into the visible tree so
  // it lights up even when set programmatically (e.g. from file-list ".." nav).
  useEffect(() => {
    if (!root || !session) return;
    async function ensurePath() {
      if (!root || !session) return;
      // Walk down from root, expand each segment.
      const segs = selected.split("/").filter(Boolean);
      let cur = root;
      let p = "";
      const newExpanded = new Set(expanded);
      for (const seg of segs) {
        p = p + "/" + seg;
        if (!cur.loaded) {
          await loadChildren(cur);
        }
        const child = cur.children.find((c) => c.path === p);
        if (!child) break;
        newExpanded.add(cur.path);
        cur = child;
      }
      setExpanded(newExpanded);
      setRoot({ ...root });
    }
    ensurePath();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, session?.id]);

  if (!session)
    return (
      <div className="h-full flex items-center justify-center text-[11px] text-zinc-600">
        세션 미연결
      </div>
    );
  if (!root) return <div className="h-full" />;

  return (
    <div className="h-full overflow-y-auto py-1">{renderNode(root, 0)}</div>
  );
}

// Re-export joinPath so callers can use the same utility.
export { joinPath };
