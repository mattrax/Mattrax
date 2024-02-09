package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/mattrax/xml"
	"github.com/oscartbeaumont/forge/dominion/internal"
	"github.com/oscartbeaumont/forge/dominion/internal/api"
	"github.com/oscartbeaumont/forge/dominion/internal/azuread"
	"github.com/oscartbeaumont/forge/dominion/internal/certificates"
	"github.com/oscartbeaumont/forge/dominion/pkg/syncml"
)

// Manage handles the continued management of the device.
func Manage(mttxAPI api.Service, aadService *azuread.Service, certService *certificates.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var cmd syncml.Message
		if err := syncml.NewDecoder(r.Body).Decode(&cmd); err != nil {
			err = fmt.Errorf("error marshaling syncml body from client: %w", err)
			log.Printf("[Error] Manage | %v\n", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		if cmd.Header.VerDTD != "1.2" {
			// TODO: Error
			fmt.Println("Invalid Version")
		} else if cmd.Header.VerProto != "DM/1.2" {
			// TODO: Error
			fmt.Println("Invalid Proto")
		} else if strings.Split(r.URL.String(), "?")[0] != strings.Split(cmd.Header.TargetURI, "?")[0] {
			// TODO: Error
			fmt.Println("Invalid TargetURI")
		} else if cmd.Header.SourceURI == "" {
			// TODO: Error
			fmt.Println("Invalid SourceURI")
		}

		deviceID := cmd.Header.SourceURI

		if len(r.TLS.PeerCertificates) == 0 {
			// TODO: Error
			fmt.Println("No authentication certificate provided")

			// err := fmt.Errorf("no authentication certificate was found")
			// log.Printf("[Error] Manage | %s\n", err)
			// txn.NoticeError(err)
			// return syncml.NewBlankResponse(cmd, syncml.StatusUnauthorized)
		} else if cmd.Header.SourceURI != r.TLS.PeerCertificates[0].Subject.CommonName { // TODO: Fix this when then comman name can be an email
			// TODO: Error
			fmt.Println("Certificate and device mismatch")

			// err := fmt.Errorf("certificate and device mismatch")
			// log.Printf("[Error] Manage | %s\n", err)
			// txn.NoticeError(err)
			// return syncml.NewBlankResponse(cmd, syncml.StatusForbidden)
		}
		// txn.AddAttribute("certificate-subject", r.TLS.PeerCertificates[0].Subject.String())

		// deviceMode := r.URL.Query().Get("mode")
		devicePlatform := r.URL.Query().Get("Platform")

		fmt.Println(r.URL.String(), devicePlatform)
		if devicePlatform != "WoA" {
			// TODO: Error
			fmt.Println("Invalid Device Platform")
		}

		// TODO: URL Empty when AzureAD Enrolled. Lol

		var context = api.ManageContext{
			UDID:     cmd.Header.SourceURI,
			DeviceID: deviceID,
		}

		if r.Header.Get("Authorization") != "" {
			claims, err := aadService.VerifyAuthenticationToken(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
			if err != nil {
				// TODO: Error
				fmt.Println("AAD Verification Error", err)
			}
			context.UPN = claims.UserPrincipalName
			context.AADUserOID = claims.ObjectID
			context.AADDeviceID = claims.DeviceID
		}

		// fmt.Println(r.TLS.PeerCertificates[0].Subject.String())

		// var upn = Ternary(azureUPN != "", azureUPN, Ternary(userEnrolled, r.TLS.PeerCertificates[0].Subject.String(), ""))
		// context.ManagedUser: upn != "", // deviceMode == "Maintenance", // TODO: Does this work with non-AAD Managed vs NonManaged user (user vs other in other thingo)

		fmt.Println(r.Header.Get("MDM-GenericAlert")) // TODO: Handle this feaure, Reference: Note 5: The MDM-GenericAlert

		if err := ManageHandler(mttxAPI, aadService, cmd, context).Respond(w); err != nil {
			err = fmt.Errorf("error sending response to client: %w", err)
			log.Printf("[Error] Manage | %v\n", err)
			return
		}
	}
}

// ManageHandler handles the management process of the protocol after authentication is complete
func ManageHandler(mttxAPI api.Service, aadService *azuread.Service, cmd syncml.Message, context api.ManageContext) syncml.Response {
	var res, resCmdID = syncml.NewResponse(cmd)

	var clientStatus string
	var tree = map[api.NodeLoc]api.Node{}
	for _, command := range cmd.Body.Commands {
		fmt.Println(command)
		treeLoc := api.NodeLoc{
			MsgID: command.MsgRef,
			CmdID: command.CmdRef,
		}

		node, ok := tree[treeLoc]
		if !ok {
			node = api.Node{
				Data: map[string]api.NodeData{},
			}
		}

		if command.XMLName.Local == "Status" {
			if command.CmdRef == "0" && command.Cmd == "SyncHdr" {
				clientStatus = internal.Ternary(command.Data != nil, command.Data.Value, "0")
				if command.Data.Value != "200" {
					break
				}
			} else {
				if command.TargetRef != "" {
					node.Cmd = command.Cmd // TODO: Does this work with Atomics
					node.Status = "0"
					node.Data[command.TargetRef] = api.NodeData{
						Status:     command.Data.Value,
						MSFTStatus: command.Data.MSFTOriginalError,
					}
				} else {
					node.Cmd = command.Cmd
					node.Status = command.Data.Value
					node.MSFTStatus = command.Data.MSFTOriginalError
				}
			}
		}

		if command.XMLName.Local == "Results" || command.XMLName.Local == "Replace" {
			if node.Cmd == "" {
				node.Cmd = command.XMLName.Local
			}

			for _, item := range command.Body {
				var nodeData = node.Data[item.Source.URI]
				if item.Meta != nil {
					nodeData.Format = item.Meta.Format
					nodeData.Type = item.Meta.Type
				}

				if item.Data != nil {
					nodeData.Data = item.Data.Value
				}

				node.Data[item.Source.URI] = nodeData
			}
		}

		if command.XMLName.Local == "Alert" {
			for _, item := range command.Body {
				var meta = item.Meta
				if meta != nil {
					meta = &syncml.Meta{}
				}

				if item.Data != nil {
					// TODO: Error
					fmt.Println("Invalid Command")
					break
				}

				if command.Data.Value == "1201" /* TODO Constant */ {
					break
				} else if command.Data.Value == syncml.GenericAlert {
					if item.Meta.Type == "com.microsoft:mdm.unenrollment.userrequest" {

					}
				} else if command.Data.Value == syncml.DeviceAlert {
					if item.Meta.Type == "com.microsoft/MDM/LoginStatus" {
						context.IsManagedUser = (item.Data.Value == "user")
					}

					if item.Meta.Type == "Reversed-Domain-Name:com.microsoft.mdm.win32csp_install" {
						// var nodeData = node.Data[item.Source.URI]
						// nodeData.Status = item.Data.Value
						// nodeData.MSFTStatus = item.Data.MSFTOriginalError

						// node.Data[item.Source.URI] = nodeData
					}
				} else {
					// TODO
				}

				// if command.Data.Value == syncml.GenericAlert && item.Meta != nil && item.Meta.Type == "com.microsoft:mdm.unenrollment.userrequest" && item.Meta.Format == "int" && item.Data.Value == "1" {
				// 	if err := mttxAPI.Checkout(txn, context.DeviceID); err != nil {
				// 		// TODO: Handle this
				// 		log.Println("API Error", err)
				// 	}
				// }

				// TODO: Implement Alerts (1200 1201 1223 1222 1224 1225 1226)
			}
		}

		if command.XMLName.Local == "Final" {
			break
		}

		tree[treeLoc] = node
	}

	if clientStatus != "200" {
		// TODO: Handle this
		log.Println(fmt.Sprintf("The Device Reported Error '%v' to the previous message", clientStatus))
	}

	resTree, err := mttxAPI.Manage(context, resCmdID, tree)
	if err != nil {
		// TODO: Handle this
		log.Println("API Error", err)
	}

	for cmdID, node := range resTree {
		res.SetAdvanced(node.Cmd, cmdID, OMANodeFromAPINode(node))
	}

	return res
}

// OMANodeFromAPINode converts an api.Node into a OMA command that the device can understand. This function is recursive to support Atomics.
func OMANodeFromAPINode(node api.Node) []syncml.Command {
	var body []syncml.Command

	for omaURI, item := range node.Data {
		var meta *syncml.Meta
		if item.Format != "" || item.Type != "" {
			meta = &syncml.Meta{
				Format: item.Format,
				Type:   item.Type,
			}
		}

		var data *syncml.CommandData
		if item.Data != "" {
			data = &syncml.CommandData{
				Value: item.Data,
			}
		}

		body = append(body, syncml.Command{
			XMLName: xml.Name{
				Local: "Item",
			},
			Target: &syncml.LocURI{
				URI: omaURI,
			},
			Meta: meta,
			Data: data,
		})
	}

	for cmdID, innerNode := range node.Nodes {
		body = append(body, syncml.Command{
			XMLName: xml.Name{
				Local: node.Cmd,
			},
			CmdID: cmdID,
			Body:  OMANodeFromAPINode(innerNode),
		})
	}

	return body
}
