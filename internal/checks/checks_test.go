package checks

import "testing"

func TestExtractPreservablesURLStopsAtQuote(t *testing.T) {
	source := `<a href="https://weblate.org">Weblate</a>.`
	tokens := extractPreservables(source, map[string]bool{"urls": true})
	if len(tokens) != 1 {
		t.Fatalf("expected 1 token, got %d: %#v", len(tokens), tokens)
	}
	if tokens[0] != "https://weblate.org" {
		t.Fatalf("expected url token to stop at quote, got %q", tokens[0])
	}
}
