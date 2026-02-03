import { join, dirname } from "path";
import { statSync } from "fs";

export function findRoot(start: string): string {
  let dir = start;
  while (true) {
    try {
      statSync(join(dir, ".git"));
      return dir;
    } catch {
      // not found, go up
    }
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
