#!/usr/bin/env node
/**
 * Checks whether git changes touch any T4 Code locked customization registered in T4_CUSTOMIZATIONS.md.
 *
 * Usage:
 *   vp run check:t4-locks                    # checks staged + unstaged working tree changes
 *   vp run check:t4-locks origin/main..HEAD  # checks a git commit range
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

interface LockEntry {
  readonly id: string;
  readonly title: string;
  readonly paths: string[];
}

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const manifestPath = NodePath.join(repoRoot, "T4_CUSTOMIZATIONS.md");

function parseManifest(markdown: string): LockEntry[] {
  const entries: LockEntry[] = [];
  let current: LockEntry | null = null;
  let inPaths = false;

  for (const rawLine of markdown.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const headingMatch = /^###\s+\d+\.\s+(.+)$/u.exec(line);
    if (headingMatch) {
      current = { id: "", title: headingMatch[1]!.trim(), paths: [] };
      entries.push(current);
      inPaths = false;
      continue;
    }

    const idMatch = /^<!--\s*t4-lock:\s*([a-z0-9-]+)\s*-->$/u.exec(line);
    if (idMatch && current) {
      current.id = idMatch[1]!;
      continue;
    }

    if (line.startsWith("- **Protected Paths**:")) {
      inPaths = true;
      continue;
    }

    if (inPaths) {
      const pathMatch = /^-\s+`([^`]+)`$/u.exec(line);
      if (pathMatch && current) {
        current.paths.push(pathMatch[1]!);
      } else if (line.startsWith("- **") || line.startsWith("### ") || line === "---") {
        inPaths = false;
      }
    }
  }

  return entries.filter((entry) => entry.id.length > 0 && entry.paths.length > 0);
}

function getChangedFiles(rangeArg: string | undefined): string[] {
  if (rangeArg) {
    const out = NodeChildProcess.execFileSync("git", ["diff", "--name-only", rangeArg], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return out
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const staged = NodeChildProcess.execFileSync("git", ["diff", "--cached", "--name-only"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const unstaged = NodeChildProcess.execFileSync("git", ["diff", "--name-only"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return [
    ...new Set(
      [...staged.split(/\r?\n/u), ...unstaged.split(/\r?\n/u)].map((l) => l.trim()).filter(Boolean),
    ),
  ];
}

function matchesProtectedPath(changedFile: string, protectedPath: string): boolean {
  if (protectedPath.endsWith("/")) {
    return changedFile.startsWith(protectedPath);
  }
  return changedFile === protectedPath;
}

const manifest = NodeFS.readFileSync(manifestPath, "utf8");
const locks = parseManifest(manifest);
const rangeArg = process.argv[2];
const changedFiles = getChangedFiles(rangeArg);

const hits = new Map<LockEntry, string[]>();
for (const file of changedFiles) {
  for (const lock of locks) {
    if (lock.paths.some((protectedPath) => matchesProtectedPath(file, protectedPath))) {
      const list = hits.get(lock) ?? [];
      list.push(file);
      hits.set(lock, list);
    }
  }
}

if (hits.size === 0) {
  console.log(
    `[check:t4-locks] OK — ${changedFiles.length} changed file(s), 0 locked T4 modules touched.`,
  );
  process.exit(0);
}

console.log(
  `[check:t4-locks] WARNING — ${hits.size} locked T4 module(s) touched across ${changedFiles.length} changed file(s):`,
);
for (const [lock, files] of hits) {
  console.log(`\n  • [${lock.id}] ${lock.title}`);
  for (const file of files) {
    console.log(`      - ${file}`);
  }
}
console.log(
  `\nReview T4_CUSTOMIZATIONS.md invariants before merging/releasing. Never silently overwrite locked T4 features.`,
);
