module.exports = {
  layout: "layouts/base.njk",
  pagination: {
    data: "localeCodes",
    size: 1,
    alias: "localeCode"
  },
  permalink: (data) => {
    if (!data.localeCode) {
      return "/";
    }
    return data.localeCode === "en" ? "/" : `/${data.localeCode}/`;
  }
};
