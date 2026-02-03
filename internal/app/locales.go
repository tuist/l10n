package app

import "strings"

type Locale struct {
	Code string
	Name string
}

func defaultLocales() []Locale {
	return []Locale{
		{Code: "ar", Name: "Arabic"},
		{Code: "bg", Name: "Bulgarian"},
		{Code: "cs", Name: "Czech"},
		{Code: "da", Name: "Danish"},
		{Code: "de", Name: "German"},
		{Code: "el", Name: "Greek"},
		{Code: "en", Name: "English"},
		{Code: "en-GB", Name: "English (UK)"},
		{Code: "en-US", Name: "English (US)"},
		{Code: "es", Name: "Spanish"},
		{Code: "es-419", Name: "Spanish (Latin America)"},
		{Code: "et", Name: "Estonian"},
		{Code: "fi", Name: "Finnish"},
		{Code: "fr", Name: "French"},
		{Code: "he", Name: "Hebrew"},
		{Code: "hi", Name: "Hindi"},
		{Code: "hr", Name: "Croatian"},
		{Code: "hu", Name: "Hungarian"},
		{Code: "id", Name: "Indonesian"},
		{Code: "it", Name: "Italian"},
		{Code: "ja", Name: "Japanese"},
		{Code: "ko", Name: "Korean"},
		{Code: "lt", Name: "Lithuanian"},
		{Code: "lv", Name: "Latvian"},
		{Code: "ms", Name: "Malay"},
		{Code: "nb", Name: "Norwegian Bokmal"},
		{Code: "nl", Name: "Dutch"},
		{Code: "pl", Name: "Polish"},
		{Code: "pt", Name: "Portuguese"},
		{Code: "pt-BR", Name: "Portuguese (Brazil)"},
		{Code: "pt-PT", Name: "Portuguese (Portugal)"},
		{Code: "ro", Name: "Romanian"},
		{Code: "ru", Name: "Russian"},
		{Code: "sk", Name: "Slovak"},
		{Code: "sl", Name: "Slovenian"},
		{Code: "sv", Name: "Swedish"},
		{Code: "th", Name: "Thai"},
		{Code: "tr", Name: "Turkish"},
		{Code: "uk", Name: "Ukrainian"},
		{Code: "vi", Name: "Vietnamese"},
		{Code: "zh-Hans", Name: "Chinese (Simplified)"},
		{Code: "zh-Hant", Name: "Chinese (Traditional)"},
	}
}

func localeLabel(locale Locale) string {
	if strings.TrimSpace(locale.Name) == "" {
		return locale.Code
	}
	return locale.Name + " (" + locale.Code + ")"
}

func localeNameByCode(locales []Locale) map[string]string {
	out := map[string]string{}
	for _, locale := range locales {
		out[locale.Code] = locale.Name
	}
	return out
}
