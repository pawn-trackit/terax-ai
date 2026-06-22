import type { SourceControlFileEntry } from "./useSourceControlPanel";

// One flattened render row for the tree view: either a collapsible folder or a
// changed-file leaf. `depth` drives indentation; the file row reuses the panel's
// existing EntryRow so staging/discard/selection all behave identically to the
// flat list.
export type ScmTreeRow =
  | {
      kind: "folder";
      key: string;
      path: string;
      label: string;
      depth: number;
      collapsed: boolean;
    }
  | { kind: "file"; key: string; depth: number; entry: SourceControlFileEntry };

type FolderNode = {
  name: string;
  path: string;
  folders: Map<string, FolderNode>;
  files: SourceControlFileEntry[];
};

function newFolder(name: string, path: string): FolderNode {
  return { name, path, folders: new Map(), files: [] };
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

// Build a nested folder tree from the flat changed-file list, then flatten it
// into render rows. Folders sort before files, both alphabetical. Single-child
// folder chains are compacted (src/modules/source-control → one row) so deep
// repos don't produce a tower of one-item levels; anything under a collapsed
// folder is omitted. `collapsed` holds the deepest path of each collapsed (and
// compacted) folder row.
export function buildScmTree(
  entries: SourceControlFileEntry[],
  collapsed: ReadonlySet<string>,
): ScmTreeRow[] {
  const root = newFolder("", "");
  for (const entry of entries) {
    const segments = entry.path.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i];
      const path = node.path ? `${node.path}/${name}` : name;
      let next = node.folders.get(name);
      if (!next) {
        next = newFolder(name, path);
        node.folders.set(name, next);
      }
      node = next;
    }
    node.files.push(entry);
  }

  const rows: ScmTreeRow[] = [];
  const walk = (node: FolderNode, depth: number) => {
    const folders = [...node.folders.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const folder of folders) {
      // Compact: while a folder holds no files of its own and exactly one
      // subfolder, fold the child's name into this row and descend.
      let cur = folder;
      let label = folder.name;
      while (cur.files.length === 0 && cur.folders.size === 1) {
        const only = [...cur.folders.values()][0];
        label += `/${only.name}`;
        cur = only;
      }
      const isCollapsed = collapsed.has(cur.path);
      rows.push({
        kind: "folder",
        key: `folder:${cur.path}`,
        path: cur.path,
        label,
        depth,
        collapsed: isCollapsed,
      });
      if (!isCollapsed) walk(cur, depth + 1);
    }
    const files = [...node.files].sort((a, b) =>
      basename(a.path).localeCompare(basename(b.path)),
    );
    for (const entry of files) {
      rows.push({ kind: "file", key: entry.key, depth, entry });
    }
  };
  walk(root, 0);
  return rows;
}
