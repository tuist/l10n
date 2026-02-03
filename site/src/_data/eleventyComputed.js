const fs = require("fs");
const path = require("path");

function localeFromStem(stem) {
  const parts = stem.split("/").filter(Boolean);
  const idx = parts.indexOf("i18n");
  if (idx !== -1 && parts.length > idx + 1) {
    return parts[idx + 1];
  }
  return "en";
}

function stripI18n(stem) {
  const parts = stem.split("/").filter(Boolean);
  const idx = parts.indexOf("i18n");
  if (idx !== -1) {
    return "/" + parts.slice(idx + 2).join("/");
  }
  return stem.startsWith("/") ? stem : "/" + stem;
}

function buildPermalink(locale, stem) {
  let base = stripI18n(stem);
  if (base === "/index") {
    base = "/";
  }
  if (!base.endsWith("/")) {
    base = base + "/";
  }
  if (locale === "en") {
    return base;
  }
  return "/" + locale + (base === "/" ? "/" : base);
}

function resolveLocale(data) {
  if (data.locale) {
    return data.locale;
  }
  if (data.localeCode) {
    return data.localeCode;
  }
  if (!data.page || !data.page.filePathStem) {
    return "en";
  }
  return localeFromStem(data.page.filePathStem);
}

function loadJSONIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function mergeDeep(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return override ?? base;
  }
  const out = Array.isArray(base) ? base.slice() : { ...(base || {}) };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = mergeDeep(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function loadLocalizedData(name, locale) {
  const dataDir = __dirname;
  const basePath = path.join(dataDir, `${name}.json`);
  const base = loadJSONIfExists(basePath) || {};
  if (!locale || locale === "en") {
    return base;
  }
  const localizedPath = path.join(dataDir, "i18n", locale, `${name}.json`);
  const localized = loadJSONIfExists(localizedPath);
  if (!localized) {
    return base;
  }
  return mergeDeep(base, localized);
}

function isHomePage(data) {
  if (!data.page || !data.page.filePathStem) {
    return false;
  }
  return stripI18n(data.page.filePathStem) === "/index";
}

module.exports = {
  eleventyComputed: {
    locale: (data) => {
      const result = resolveLocale(data);
      if (data.page && data.page.filePathStem === "/index") {
        console.log(`[DEBUG locale] localeCode=${data.localeCode}, locale=${data.locale}, result=${result}`);
      }
      return result;
    },
    permalink: (data) => {
      if (data.permalink) {
        return data.permalink;
      }
      if (!data.page || !data.page.filePathStem) {
        return data.permalink;
      }
      return buildPermalink(localeFromStem(data.page.filePathStem), data.page.filePathStem);
    },
    ui: (data) => loadLocalizedData("ui", resolveLocale(data)),
    home: (data) => {
      if (!isHomePage(data)) {
        return data.home;
      }
      return loadLocalizedData("home", resolveLocale(data));
    },
    title: (data) => {
      if (data.title) {
        return data.title;
      }
      if (data.home && data.home.meta && data.home.meta.title) {
        return data.home.meta.title;
      }
      return data.title;
    },
    description: (data) => {
      if (data.description) {
        return data.description;
      }
      if (data.home && data.home.meta && data.home.meta.description) {
        return data.home.meta.description;
      }
      return data.description;
    }
  }
};
