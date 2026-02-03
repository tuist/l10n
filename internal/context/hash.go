package context

import (
	"crypto/sha256"
	"encoding/hex"
)

func HashString(input string) string {
	return HashBytes([]byte(input))
}

func HashBytes(input []byte) string {
	hash := sha256.Sum256(input)
	return hex.EncodeToString(hash[:])
}

func HashStrings(parts []string) string {
	combined := ""
	for i, part := range parts {
		if i > 0 {
			combined += "\n\n"
		}
		combined += part
	}
	return HashString(combined)
}
