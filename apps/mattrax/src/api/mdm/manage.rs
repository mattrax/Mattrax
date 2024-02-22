use std::sync::Arc;

use axum::{routing::post, Router};
use hyper::header;
use ms_mdm::{
    Cmd, CmdId, CmdRef, Data, Final, Meta, MsgRef, Status, SyncBody, SyncHdr, SyncML,
    MAX_REQUEST_BODY_SIZE,
};

use crate::api::Context;

// // CommandID is a helper for generating SyncML Command ID's
// type CommandID int32

// // Next returns the next available CommandID
// func (id *CommandID) Next() string {
// 	return fmt.Sprintf("%x", atomic.AddInt32((*int32)(id), 1))
// }

pub fn mount(_state: Arc<Context>) -> Router<Arc<Context>> {
    Router::new().route(
        "/Manage.svc",
        post(|body: String| async move {
            // TODO: Mutual TLS authentication

            let cmd = match SyncML::from_str(&body) {
                Ok(cmd) => cmd,
                Err(err) => {
                    println!("\nBODY: {body}\n");
                    panic!("{:?}", err); // TODO: Error handling
                }
            };
            println!("{:#?}", cmd);

            // TODO: How to properly report errors to the device so they show up in logs????
            // if cmd.Header.VerDTD != "1.2" {
            //     // TODO: Error
            //     fmt.Println("Invalid Version")
            // } else if cmd.Header.VerProto != "DM/1.2" {
            //     // TODO: Error
            //     fmt.Println("Invalid Proto")
            // } else if strings.Split(r.URL.String(), "?")[0] != strings.Split(cmd.Header.TargetURI, "?")[0] {
            //     // TODO: Error
            //     fmt.Println("Invalid TargetURI")
            // } else if cmd.Header.SourceURI == "" {
            //     // TODO: Error
            //     fmt.Println("Invalid SourceURI")
            // }

            // deviceID := cmd.Header.SourceURI

            // if len(r.TLS.PeerCertificates) == 0 {
            //     // TODO: Error
            //     fmt.Println("No authentication certificate provided")

            //     // err := fmt.Errorf("no authentication certificate was found")
            //     // log.Printf("[Error] Manage | %s\n", err)
            //     // txn.NoticeError(err)
            //     // return syncml.NewBlankResponse(cmd, syncml.StatusUnauthorized)
            // } else if cmd.Header.SourceURI != r.TLS.PeerCertificates[0].Subject.CommonName { // TODO: Fix this when then comman name can be an email
            //     // TODO: Error
            //     fmt.Println("Certificate and device mismatch")

            //     // err := fmt.Errorf("certificate and device mismatch")
            //     // log.Printf("[Error] Manage | %s\n", err)
            //     // txn.NoticeError(err)
            //     // return syncml.NewBlankResponse(cmd, syncml.StatusForbidden)
            // }
            // // txn.AddAttribute("certificate-subject", r.TLS.PeerCertificates[0].Subject.String())

            // // deviceMode := r.URL.Query().Get("mode")
            // devicePlatform := r.URL.Query().Get("Platform")

            // fmt.Println(r.URL.String(), devicePlatform)
            // if devicePlatform != "WoA" {
            //     // TODO: Error
            //     fmt.Println("Invalid Device Platform")
            // }

            // TODO: URL Empty when AzureAD Enrolled. Lol

            // var context = api.ManageContext{
            //     UDID:     cmd.Header.SourceURI,
            //     DeviceID: deviceID,
            // }
            // if r.Header.Get("Authorization") != "" {
            //     claims, err := aadService.VerifyAuthenticationToken(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
            //     if err != nil {
            //         // TODO: Error
            //         fmt.Println("AAD Verification Error", err)
            //     }
            //     context.UPN = claims.UserPrincipalName
            //     context.AADUserOID = claims.ObjectID
            //     context.AADDeviceID = claims.DeviceID
            // }

            // fmt.Println(r.TLS.PeerCertificates[0].Subject.String())

            // var upn = Ternary(azureUPN != "", azureUPN, Ternary(userEnrolled, r.TLS.PeerCertificates[0].Subject.String(), ""))
            // context.ManagedUser: upn != "", // deviceMode == "Maintenance", // TODO: Does this work with non-AAD Managed vs NonManaged user (user vs other in other thingo)

            // fmt.Println(r.Header.Get("MDM-GenericAlert")) // TODO: Handle this feaure, Reference: Note 5: The MDM-GenericAlert

            // TODO: Check `MS-Signature` header - base64 CMS detached + signature SHA-2 hash & check timestamp
            // TODO: Decode `Mode` from URL params
            // TODO: `Authorization` + `Bearer` token for AzureAD user account

            // TODO: `client-request-id` header will match `EntDMID`.

            // TODO: `MDM-GenericAlert` header. - https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-mdm/d9b0c913-b0b1-4ee5-883c-496a7ed1d3f9
            // TODO: "bidirectional confidentiality and integrity checks SHOULD<7> be enabled on top of the transport layer" - https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-mdm/d9b0c913-b0b1-4ee5-883c-496a7ed1d3f9
            // TODO: `MS-CV` header - https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-mdm/d9b0c913-b0b1-4ee5-883c-496a7ed1d3f9

            // TODO: application/vnd.syncml.dm+xml
            // TODO: application/vnd.syncml.dm+wbxml

            // Status MUST be returned for the SyncHdr (section 2.2.4.2) and MUST be the first Status element
            // in the SyncBody of the response. Even in the case where Status elements for a previous request
            // span multiple messages and responses, the Status in the SyncHdr MUST be the first Status
            // element in the SyncBody followed by other Status elements and/or remaining Status elements
            // for previous requests. However, when a client creates a message containing only a successful
            // Status in a SyncHdr, the entire message MUST NOT be sent. A server MUST send this message.

            // When CmdRef is "0", Cmd can also be set to "SyncHdr".

            // TODO: Take into account max message size

            let msg_ref = MsgRef::from(&cmd.hdr);

            // TODO: Helper for constructing this
            let response = SyncML {
                hdr: SyncHdr {
                    version: cmd.hdr.version,
                    version_protocol: cmd.hdr.version_protocol,
                    session_id: cmd.hdr.session_id,
                    msg_id: cmd.hdr.msg_id,
                    target: cmd.hdr.source.into(),
                    source: cmd.hdr.target.into(),
                    // TODO: Make this work
                    meta: None,
                    // meta: Some(Meta {
                    //     max_request_body_size: Some(MAX_REQUEST_BODY_SIZE),
                    // }),
                },
                child: SyncBody {
                    children: vec![Status {
                        cmd_id: CmdId::new("1").unwrap(), // TODO: Helper for these
                        msg_ref,
                        cmd_ref: CmdRef::zero(), // TODO: Remove `zero` function and use special helper???
                        cmd: "SyncHdr".into(),
                        data: "200".into(),
                        // data: Data {
                        //     msft_originalerror: None,
                        //     child: "200".into(), // TODO: Use SyncML status abstraction
                        // },
                        item: vec![],
                        target_ref: None,
                        source_ref: None,
                    }
                    .into()],
                    _final: Some(Final),
                },
            };

            let result = response.to_string().unwrap(); // TODO: Error handling
                                                        // let result = result.replace(r#"<?xml version="1.0" encoding="UTF-8"?>"#, "");
            println!("\nRESULT: {result}\n");
            (
                [(header::CONTENT_TYPE, "application/vnd.syncml.dm+xml")],
                result,
            )
        }),
    )
    // TODO: `ManagementServer/ServerList.svc` -> What does this do again???
}

// TODO:
// - Sync device information if it's changed
// - Push to Mattrax agent if it's not installed
// - Push policies

// CmdRef MUST refer to the CmdID (section 2.2.3.2) of the SyncML command referred
// to by Status. CmdRef MUST be present in the SyncML message, except when the Status command
// refers to the SyncHdr (section 2.2.4.2) of the associated SyncML request message. For example, a
// status can be sent back to the originator for exceptions (that is, (401) Unauthorized) found within the
// SyncHdr of the originator’s request.

// The order of Status elements in a SyncML response MUST match the order of the corresponding commands in the SyncML request.
// there is a 1:1 correspondence between a command and the Status element

// When multiple Item (section 2.2.5.2) elements are specified in a command, if the status codes for
// all Items are not identical, a unique Status element MUST be returned for each Item. If all status
// codes are identical, the same Status element MAY be returned for all Items.

// MDM permits a Status to be issued against another Status (or, Status on a Status). While this
// case is not usually encountered, there are extreme cases where this feature is necessary. For
// example, if a server returns a (401) Unauthorized status code with a request for an authentication
// scheme that is not supported by the client, the client might use a (406) Optional feature
// unsupported code to notify the server that that requested authentication scheme is not supported
// and negotiate an authentication scheme that it does support. SyncML servers and SyncML clients
// that do not support this use case are not required to provide further response to the SyncML
// entity that is issuing the Status on a Status.
