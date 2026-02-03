import { join, dirname } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";

export interface OutputLock {
  path: string;
  hash: string;
  context_hash?: string;
  checked_at: string;
}

export interface LockFile {
  source_path: string;
  source_hash: string;
  context_hash?: string;
  outputs: Record<string, OutputLock>;
  updated_at: string;
}

export function lockPath(root: string, sourcePath: string): string {
  return join(root, ".l10n", "locks", sourcePath + ".lock");
}

export async function readLock(
  root: string,
  sourcePath: string,
): Promise<LockFile | null> {
  const path = lockPath(root, sourcePath);
  try {
    const data = await readFile(path, "utf-8");
    return JSON.parse(data) as LockFile;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeLock(
  root: string,
  sourcePath: string,
  lock: LockFile,
): Promise<void> {
  lock.updated_at = new Date().toISOString();
  const path = lockPath(root, sourcePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(lock, null, 2) + "\n");
}
