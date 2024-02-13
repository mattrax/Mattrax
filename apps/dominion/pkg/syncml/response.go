package syncml

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/mattrax/xml"
)

// Response is a SyncML response body. It has helpers to make generating responses easier
type Response struct {
	res Message
}

// Set creates a generic command on the response
func (r *Response) Set(command, cmdID, uri string, meta *Meta, dataraw interface{}) {
	var data *CommandData
	if dataraw != nil {
		data = &CommandData{
			Value: fmt.Sprintf("%v", data),
		}
	}

	r.res.Body.Commands = append(r.res.Body.Commands, Command{
		XMLName: xml.Name{
			Local: command,
		},
		CmdID: cmdID,
		Body: []Command{
			{
				XMLName: xml.Name{
					Local: "Item",
				},
				Target: &LocURI{
					URI: uri,
				},
				Meta: meta,
				Data: data,
			},
		},
	})
}

// TEMP
func (r *Response) SetAdvanced(command, cmdID string, body []Command) {
	r.res.Body.Commands = append(r.res.Body.Commands, Command{
		XMLName: xml.Name{
			Local: command,
		},
		CmdID: cmdID,
		Body:  []Command(body),
	})
}

// SetAtomic adds an Atomic command on the response
func (r *Response) SetAtomic(cmdID string, atomic Atomic) {
	r.res.Body.Commands = append(r.res.Body.Commands, Command{
		XMLName: xml.Name{
			Local: "Atomic",
		},
		CmdID: cmdID,
		Body:  []Command(atomic),
	})
}

// Atomic TODO
type Atomic []Command

// Set creates a generic command on the atomic
func (r *Atomic) Set(command, cmdID, uri string, meta *Meta, dataraw interface{}) {
	var data *CommandData
	if dataraw != nil {
		data = &CommandData{
			Value: fmt.Sprintf("%v", data),
		}
	}

	*r = append(*r, Command{
		XMLName: xml.Name{
			Local: command,
		},
		CmdID: cmdID,
		Body: []Command{
			{
				XMLName: xml.Name{
					Local: "Item",
				},
				Target: &LocURI{
					URI: uri,
				},
				Meta: meta,
				Data: data,
			},
		},
	})
}

// Respond creates the final element and encodes the response
func (r Response) Respond(w http.ResponseWriter) error {
	r.res.Body.Final = "<Final />"
	w.Header().Set("Content-Type", "application/vnd.syncml.dm+xml")
	if err := xml.NewEncoder(w).Encode(r.res); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return err
	}
	return nil
}

// SetStatus changes the SyncML body's status
func (r *Response) SetStatus(status int) {
	r.res.Body.Commands[0].Data = &CommandData{
		Value: fmt.Sprintf("%v", status),
	}
}

// FinalStatus returns the SyncML body's status
func (r *Response) FinalStatus() int32 {
	n, err := strconv.Atoi(r.res.Body.Commands[0].Data.Value)
	if err != nil {
		return -1
	}
	return int32(n)
}

// NewResponse creates a new SyncML Envelope for the response
func NewResponse(cmd Message) (Response, CommandID) {
	var resMsgID CommandID

	return Response{
		res: Message{
			XmlnA: "syncml:metinf",
			Header: Header{
				VerDTD:         cmd.Header.VerDTD,
				VerProto:       cmd.Header.VerProto,
				SessionID:      cmd.Header.SessionID,
				MsgID:          cmd.Header.MsgID,
				TargetURI:      cmd.Header.SourceURI,
				SourceURI:      cmd.Header.TargetURI,
				MetaMaxMsgSize: MaxRequestBodySize,
			},
			Body: Body{
				Commands: []Command{
					// TODO: Make this declared by main package and use the CmdID helper correctly with it
					{
						XMLName: xml.Name{
							Local: "Status",
						},
						CmdID:  resMsgID.Next(),
						MsgRef: cmd.Header.MsgID,
						CmdRef: "0",
						Cmd:    "SyncHdr",
						Data: &CommandData{
							Value: fmt.Sprintf("%v", StatusOK),
						},
					},
				},
			},
		},
	}, resMsgID
}

// NewBlankResponse creates a new empty SyncML Envelope with only a Status element
func NewBlankResponse(cmd Message, status int) Response {
	return Response{
		res: Message{
			XmlnA: "syncml:metinf",
			Header: Header{
				VerDTD:         cmd.Header.VerDTD,
				VerProto:       cmd.Header.VerProto,
				SessionID:      cmd.Header.SessionID,
				MsgID:          cmd.Header.MsgID,
				TargetURI:      cmd.Header.SourceURI,
				SourceURI:      cmd.Header.TargetURI,
				MetaMaxMsgSize: MaxRequestBodySize,
			},
			Body: Body{
				Commands: []Command{
					{
						XMLName: xml.Name{
							Local: "Status",
						},
						CmdID:  "1",
						MsgRef: cmd.Header.MsgID,
						CmdRef: "0",
						Cmd:    "SyncHdr",
						Data: &CommandData{
							Value: fmt.Sprintf("%v", status),
						},
					},
				},
			},
		},
	}
}
