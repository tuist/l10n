import { createHash } from "crypto";

export function hashString(input: string): string {
  return hashBytes(Buffer.from(input));
}

export function hashBytes(input: Buffer | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashStrings(parts: string[]): string {
  return hashString(parts.join("\n\n"));
}
