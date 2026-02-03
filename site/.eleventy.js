const { EleventyI18nPlugin } = require("@11ty/eleventy");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
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

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(EleventyI18nPlugin, { defaultLanguage: "en" });
  eleventyConfig.addPlugin(syntaxHighlight);

  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });

  const dataDir = path.join(__dirname, "src", "_data");

  function loadJSONIfExists(filePath) {
    if (!fs.existsSync(filePath)) return null;
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
    const basePath = path.join(dataDir, `${name}.json`);
    const base = loadJSONIfExists(basePath) || {};
    if (!locale || locale === "en") return base;
    const localizedPath = path.join(dataDir, "i18n", locale, `${name}.json`);
    const localized = loadJSONIfExists(localizedPath);
    if (!localized) return base;
    return mergeDeep(base, localized);
  }

  eleventyConfig.addFilter("localizedData", (name, locale) => {
    return loadLocalizedData(name, locale);
  });

  eleventyConfig.addCollection("posts", (collection) => {
    return collection
      .getFilteredByGlob("src/**/blog/*.md")
      .sort((a, b) => b.date - a.date);
  });

  eleventyConfig.addFilter("localeUrl", (page, targetLocale, currentLocale) => {
    // For paginated pages (like the home page), filePathStem is always /index
    // regardless of the current locale. We need to use currentLocale to determine
    // the canonical stem and then rebuild the permalink for the target locale.
    const stem = page.filePathStem;
    const canonical = stripI18n(stem);
    return buildPermalink(targetLocale, canonical);
  });

  eleventyConfig.addFilter("readableDate", (dateObj, locale = "en") => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(dateObj);
    } catch (err) {
      return new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(dateObj);
    }
  });

  eleventyConfig.addFilter("postsByLocale", (posts, locale) => {
    return posts.filter((post) => {
      return localeFromStem(post.filePathStem || "") === locale;
    });
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "dist"
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk"
  };
};
