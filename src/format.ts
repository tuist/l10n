import { extname } from "path";

export type Format = "markdown" | "json" | "yaml" | "po" | "text";

export function detectFormat(path: string): Format {
  const ext = extname(path).toLowerCase().replace(/^\./, "");
  switch (ext) {
    case "md":
    case "markdown":
      return "markdown";
    case "json":
      return "json";
    case "yaml":
    case "yml":
      return "yaml";
    case "po":
      return "po";
    default:
      return "text";
  }
}
