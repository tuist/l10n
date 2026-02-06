import type { AgentConfig } from "./config.js";
import { FRONTMATTER_PRESERVE } from "./config.js";
import { chat, type ChatMessage, type TranslateGemmaContentPart } from "./llm.js";
import { validate, type CheckOptions } from "./checks.js";
import type { Format } from "./format.js";
import type { Reporter } from "./reporter.js";
import { toolsSummary } from "./tools.js";

export interface TranslationRequest {
  source: string;
  targetLang: string;
  format: Format;
  context: string;
  preserve: string[];
  frontmatter: string;
  checkCmd: string;
  checkCmds: Record<string, string>;
  toolReporter?: Reporter;
  progressLabel: string;
  progressCurrent: number;
  progressTotal: number;
  retries: number;
  coordinator: AgentConfig;
  translator: AgentConfig;
  root: string;
}

export async function translate(req: TranslationRequest): Promise<string> {
  let content = req.source;
  let frontmatter = "";

  if (req.format === "markdown" && req.frontmatter === FRONTMATTER_PRESERVE) {
    const split = splitMarkdownFrontmatter(req.source);
    if (split.ok) {
      frontmatter = split.frontmatter;
      content = split.body;
    }
  }

  const brief = await buildBrief(req);

  let attempts = req.retries;
  if (attempts < 0) attempts = 0;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= attempts; attempt++) {
    let translation: string;
    try {
      translation = await translateOnce(req, brief, content, lastErr);
    } catch (err: any) {
      lastErr = err;
      continue;
    }

    let final = translation;
    if (isStructuredFormat(req.format)) {
      final = stripCodeFence(final);
    }
    if (frontmatter) {
      if (final.trim()) {
        final = frontmatter + "\n" + final;
      } else {
        final = frontmatter + "\n";
      }
    }

    try {
      await validate(req.root, req.format, final, req.source, {
        preserve: req.preserve,
        checkCmd: req.checkCmd,
        checkCmds: req.checkCmds,
        reporter: req.toolReporter,
        label: req.progressLabel,
        current: req.progressCurrent,
        total: req.progressTotal,
      });
      return final;
    } catch (checkErr: any) {
      lastErr = checkErr;
    }
  }

  throw lastErr ?? new Error("translation failed");
}

async function buildBrief(req: TranslationRequest): Promise<string> {
  const model = (req.coordinator.model ?? "").trim();
  if (!model) return defaultBrief(req);

  const prompt = `You are a localization coordinator.
Create a short translation brief for the translator.
The brief must be plain text and under 12 lines.

Target language: ${req.targetLang}
Format: ${req.format}
Preserve: ${req.preserve.join(", ")}
Frontmatter mode: ${req.frontmatter}
Tools: ${toolsSummary()}

Context:
${req.context}
`;

  const resp = await chat(req.coordinator, model, [
    {
      role: "system",
      content: "You coordinate translations and produce concise briefs.",
    },
    { role: "user", content: prompt },
  ]);
  return resp.trim();
}

function defaultBrief(req: TranslationRequest): string {
  const lines = [
    "Translate the content faithfully and naturally.",
    "Preserve code blocks, inline code, URLs, and placeholders.",
    "Keep formatting, lists, and headings intact.",
    "Return only the translated content.",
  ];
  if (isStructuredFormat(req.format)) {
    lines.push(`Return valid ${req.format} only. Do not wrap in markdown fences.`);
  }
  if (req.frontmatter === FRONTMATTER_PRESERVE) {
    lines.push("Frontmatter is preserved separately; do not add new frontmatter.");
  }
  lines.push(`Tools run after translation: ${toolsSummary()}.`);
  return lines.join("\n");
}

// TranslateGemma uses ISO 639-1 codes; map l10n's BCP 47 variants to what the model expects.
const LANG_CODE_MAP: Record<string, string> = {
  "zh-Hans": "zh",
  "zh-Hant": "zh",
};

function mapLangCode(lang: string): string {
  return LANG_CODE_MAP[lang] ?? lang;
}

function isTranslateGemma(model: string): boolean {
  return model.toLowerCase().includes("translategemma");
}

async function translateOnce(
  req: TranslationRequest,
  brief: string,
  content: string,
  lastErr: Error | null,
): Promise<string> {
  const model = (req.translator.model ?? "").trim();
  if (!model) throw new Error("translator model is required");

  if (isTranslateGemma(model)) {
    return translateOnceGemma(req, model, content);
  }

  let user = `Translate to ${req.targetLang}.\n\nContext:\n${req.context}\n\nSource:\n${content}`;
  if (lastErr) {
    user += `\n\nPrevious output failed validation: ${lastErr.message}\nReturn a corrected full translation.`;
  }

  const resp = await chat(req.translator, model, [
    {
      role: "system",
      content: `You are a translation engine. Follow this brief:\n${brief}`,
    },
    { role: "user", content: user },
  ]);
  return resp.replace(/\n+$/, "");
}

async function translateOnceGemma(
  req: TranslationRequest,
  model: string,
  content: string,
): Promise<string> {
  const parts: TranslateGemmaContentPart[] = [
    {
      type: "text",
      source_lang_code: "en",
      target_lang_code: mapLangCode(req.targetLang),
      text: content,
    },
  ];

  const resp = await chat(req.translator, model, [{ role: "user", content: parts }]);
  return resp.replace(/\n+$/, "");
}

function splitMarkdownFrontmatter(contents: string): {
  frontmatter: string;
  body: string;
  ok: boolean;
} {
  const lines = contents.split("\n");
  if (lines.length === 0) return { frontmatter: "", body: contents, ok: false };
  const marker = lines[0].trim();
  if (marker !== "---" && marker !== "+++") {
    return { frontmatter: "", body: contents, ok: false };
  }

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === marker) {
      end = i;
      break;
    }
  }
  if (end === -1) return { frontmatter: "", body: contents, ok: false };

  const frontmatter = lines.slice(0, end + 1).join("\n");
  const body = lines.slice(end + 1).join("\n");
  return { frontmatter, body, ok: true };
}

function isStructuredFormat(format: Format): boolean {
  return format === "json" || format === "yaml" || format === "po";
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return content;
  const lines = trimmed.split("\n");
  if (lines.length < 2) return content;
  if (!lines[0].trim().startsWith("```")) return content;
  if (lines[lines.length - 1].trim() !== "```") return content;
  return lines.slice(1, lines.length - 1).join("\n");
}
