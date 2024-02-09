package syncml

import (
	"encoding/xml"
	"fmt"
	"io"
	"sync/atomic"
)

// MaxRequestBodySize is the maximum amount of data that is allowed in a single request
const MaxRequestBodySize = 524288

// NewDecoder exposes mattrax/xml as syncml.NewDecoder
// This prevents xml.NewDecode defaulting to encoding/xml not the forked version and causing bugs
func NewDecoder(r io.Reader) *xml.Decoder {
	return xml.NewDecoder(r)
}

// Marshal exposes mattrax/xml as syncml.Marshal
// This prevents xml.Marshal defaulting to encoding/xml not the forked version and causing bugs
func Marshal(v interface{}) ([]byte, error) {
	return xml.Marshal(v)
}

// CommandID is a helper for generating SyncML Command ID's
type CommandID int32

// Next returns the next available CommandID
func (id *CommandID) Next() string {
	return fmt.Sprintf("%x", atomic.AddInt32((*int32)(id), 1))
}
