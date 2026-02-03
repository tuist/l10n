export interface Locale {
  code: string;
  name: string;
}

export function defaultLocales(): Locale[] {
  return [
    { code: "ar", name: "Arabic" },
    { code: "bg", name: "Bulgarian" },
    { code: "cs", name: "Czech" },
    { code: "da", name: "Danish" },
    { code: "de", name: "German" },
    { code: "el", name: "Greek" },
    { code: "en", name: "English" },
    { code: "en-GB", name: "English (UK)" },
    { code: "en-US", name: "English (US)" },
    { code: "es", name: "Spanish" },
    { code: "es-419", name: "Spanish (Latin America)" },
    { code: "et", name: "Estonian" },
    { code: "fi", name: "Finnish" },
    { code: "fr", name: "French" },
    { code: "he", name: "Hebrew" },
    { code: "hi", name: "Hindi" },
    { code: "hr", name: "Croatian" },
    { code: "hu", name: "Hungarian" },
    { code: "id", name: "Indonesian" },
    { code: "it", name: "Italian" },
    { code: "ja", name: "Japanese" },
    { code: "ko", name: "Korean" },
    { code: "lt", name: "Lithuanian" },
    { code: "lv", name: "Latvian" },
    { code: "ms", name: "Malay" },
    { code: "nb", name: "Norwegian Bokmal" },
    { code: "nl", name: "Dutch" },
    { code: "pl", name: "Polish" },
    { code: "pt", name: "Portuguese" },
    { code: "pt-BR", name: "Portuguese (Brazil)" },
    { code: "pt-PT", name: "Portuguese (Portugal)" },
    { code: "ro", name: "Romanian" },
    { code: "ru", name: "Russian" },
    { code: "sk", name: "Slovak" },
    { code: "sl", name: "Slovenian" },
    { code: "sv", name: "Swedish" },
    { code: "th", name: "Thai" },
    { code: "tr", name: "Turkish" },
    { code: "uk", name: "Ukrainian" },
    { code: "vi", name: "Vietnamese" },
    { code: "zh-Hans", name: "Chinese (Simplified)" },
    { code: "zh-Hant", name: "Chinese (Traditional)" },
  ];
}

export function localeLabel(locale: Locale): string {
  if (!locale.name?.trim()) return locale.code;
  return `${locale.name} (${locale.code})`;
}

export function localeNameByCode(
  locales: Locale[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of locales) {
    out[locale.code] = locale.name;
  }
  return out;
}
