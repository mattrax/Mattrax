package internal

// Ternary is an implementation of the Ternary operator as it doesn't exists in Go
// Future: Make this use Go Generics when they launch in the stable version
func Ternary(isA bool, a string, b string) string {
	if isA {
		return a
	}
	return b
}
