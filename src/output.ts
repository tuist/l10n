import { normalize, sep } from "path";

export interface OutputValues {
  lang: string;
  relpath: string;
  basename: string;
  ext: string;
}

export function expandOutput(template: string, values: OutputValues): string {
  let out = template;
  out = out.replaceAll("{lang}", values.lang);
  out = out.replaceAll("{relpath}", values.relpath.replaceAll(sep, "/"));
  out = out.replaceAll("{basename}", values.basename);
  out = out.replaceAll("{ext}", values.ext);
  // Convert forward slashes to OS path separators, then normalize
  out = out.replaceAll("/", sep);
  return normalize(out);
}
