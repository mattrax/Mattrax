package syncml

import "github.com/mattrax/xml"

// Message is a syncml message sent between management server and managed device
type Message struct {
	XMLName xml.Name `xml:"SYNCML:SYNCML1.2 SyncML"`
	XmlnA   string   `xml:"xmlns:A,attr"`
	Header  Header   `xml:"SyncHdr"`
	Body    Body     `xml:"SyncBody"`
}

// Header contains details about the messages protocol version, destination and source
type Header struct {
	VerDTD         string
	VerProto       string
	SessionID      string
	MsgID          string
	TargetURI      string `xml:"Target>LocURI"`
	SourceURI      string `xml:"Source>LocURI"`
	MetaMaxMsgSize int    `xml:"Meta>A:MaxMsgSize"`
}

// Body holds the SyncML commands
type Body struct {
	XmlnsMSFT string    `xml:"xmlns:msft,attr,omitempty"` // SyncApplicationVersion > "3.0"
	Commands  []Command `xml:",any"`
	Final     string    `xml:",innerxml"`
}

// A Command is an instruction or outcome from a node on the device's management tree
type Command struct {
	XMLName   xml.Name
	CmdID     string       `xml:",omitempty"`
	MsgRef    string       `xml:",omitempty"`
	CmdRef    string       `xml:",omitempty"`
	Cmd       string       `xml:",omitempty"`
	Target    *LocURI      `xml:"Target,omitempty"`
	TargetRef string       `xml:"TargetRef,omitempty"`
	Source    *LocURI      `xml:"Source,omitempty"`
	Meta      *Meta        `xml:",omitempty"`
	Body      []Command    `xml:",any"`
	Data      *CommandData `xml:"Data,omitempty"`
}

//CommandData holds the data for a node
type CommandData struct {
	MSFTOriginalError string `xml:"msft:originalerror,attr,omitempty"` // SyncApplicationVersion > "3.0"
	Value             string `xml:",innerxml"`
}

// LocURI contains a location on the management tree
type LocURI struct {
	URI string `xml:"LocURI,omitempty"`
}

// Meta contains type information for the Data
type Meta struct {
	Format string `xml:"syncml:metinf Format,omitempty"`
	Type   string `xml:"syncml:metinf Type,omitempty"`
	Mark   string `xml:"syncml:metinf Mark,omitempty"`
	// TODO: NextNonce, MaxMsgSize
}
