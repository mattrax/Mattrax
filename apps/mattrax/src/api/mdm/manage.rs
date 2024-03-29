use std::{collections::HashMap, sync::Arc};

use axum::{
    extract::{ConnectInfo, State},
    response::IntoResponse,
    routing::post,
    Router,
};
use chrono::Local;
use hyper::{header, StatusCode};
use mattrax_policy::{
    windows::{AnyValue, WindowsConfiguration},
    Configuration, Policy,
};
use ms_mde::MICROSOFT_DEVICE_ID_EXTENSION;
use ms_mdm::{
    Add, Cmd, CmdId, CmdRef, Data, Exec, Final, Format, Item, Meta, MsgRef, Replace, Source,
    Status, SyncBody, SyncBodyChild, SyncHdr, SyncML, Target, MAX_REQUEST_BODY_SIZE,
};
use mysql_async::Serialized;
use serde_json::json;
use tracing::{debug, error, info, Instrument};
use x509_parser::{
    certificate::X509Certificate,
    der_parser::{asn1_rs::FromDer, Oid},
};

use crate::api::{ConnectInfoTy, Context};

// // CommandID is a helper for generating SyncML Command ID's
// type CommandID int32

// // Next returns the next available CommandID
// func (id *CommandID) Next() string {
// 	return fmt.Sprintf("%x", atomic.AddInt32((*int32)(id), 1))
// }

pub fn mount(_state: Arc<Context>) -> Router<Arc<Context>> {
    Router::new().route(
        "/Manage.svc",
        post(
            |ConnectInfo(info): ConnectInfo<ConnectInfoTy>,
             State(state): State<Arc<Context>>,
             body: String| async move {
                let Some((common_name, device_id)) = authenticate(&state.identity_cert_x509, info)
                else {
                    return StatusCode::UNAUTHORIZED.into_response();
                };

                // TODO: Account for the AzureAD user (`Authorization` header) in this
                let upn = if common_name == device_id {
                    None
                } else {
                    Some(common_name)
                };

                info!(
                    "MDM Checkin from device '{}' as '{}'",
                    device_id,
                    upn.as_deref().unwrap_or("system")
                );

                // TODO
                // async move {

                // }.instrument(span).await

                // TODO: Update devices last checkin time

                let cmd = match SyncML::from_str(&body) {
                    Ok(cmd) => cmd,
                    Err(err) => {
                        println!("\nBODY: {body}\n");
                        panic!("{:?}", err); // TODO: Error handling
                    }
                };
                // println!("{:#?}", cmd);

                println!("{:?}", body);

                // TODO: Error handling
                let Some(device) = state
                    .db
                    .get_device(device_id)
                    .await
                    .unwrap()
                    .into_iter()
                    .nth(0)
                else {
                    return StatusCode::NOT_FOUND.into_response(); // TODO: Proper SyncML error
                };

                state
                    .db
                    .update_device_lastseen(device.pk, Local::now().naive_utc())
                    .await
                    .unwrap(); // TODO: Error handling

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

                for child in cmd.child.children.iter() {
                    println!("CHILD: {:#?}\n\n", child);

                    match child {
                        SyncBodyChild::Replace(cmd) => {
                            for item in cmd.item.iter() {
                                // println!("{:#?} {:?} {:?}", item, item.source, item.data);
                                // TODO: Do a insert many instead of multiple inserts
                                // state.db.set_device_data(
                                //     &cmd.cmd_id,
                                //     &item.source,
                                //     &item.data,
                                // ).await.unwrap(); // TODO: Error handling
                            }
                        }
                        SyncBodyChild::Status(status) => {
                            let Ok(Some(deploy_status)) = state
                                .db
                                .get_windows_ephemeral_state(
                                    cmd.hdr.session_id.as_str(),
                                    status.msg_ref.as_str().into(),
                                    status.cmd_ref.as_str().into(),
                                )
                                .await
                                .map(|v| v.into_iter().nth(0))
                            else {
                                println!(
                                    "TODO: NO STATUS FOUND for {:?} {:?} {:?}",
                                    cmd.hdr.session_id, status.msg_ref, status.cmd_ref
                                );
                                continue;
                            };

                            // TODO: Tracing log
                            println!("\n\n\nYOOOOOOOO\n{:#?}\n", deploy_status);

                            state
                                .db
                                .update_policy_deploy_status(
                                    deploy_status.deploy_pk,
                                    deploy_status.key,
                                    "success".into(), // TODO: Actually check the damn code & retry if a fix is easily possible
                                    // TODO: Could this be nullable and null means in-progress, idk how we would represent success then
                                    Serialized(json!({
                                        "status": status.data
                                    })),
                                )
                                .await
                                .unwrap(); // TODO: Error handling

                            state
                                .db
                                .delete_windows_ephemeral_state(
                                    cmd.hdr.session_id.as_str(),
                                    status.msg_ref.as_str().into(),
                                    status.cmd_ref.as_str().into(),
                                )
                                .await
                                .unwrap(); // TODO: Error handling
                        }
                        _ => {}
                    }
                }

                // TODO: Do this helper better
                let mut cmd_id = 0;
                let mut next_cmd_id = move || {
                    cmd_id += 1;
                    CmdId::new(format!("{}", cmd_id)).expect("can't be zero")
                };

                let mut children = vec![Status {
                    cmd_id: next_cmd_id(),
                    msg_ref: MsgRef::from(&cmd.hdr),
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
                .into()];

                // TODO: Do stuff on more than the first request.
                if cmd.hdr.msg_id == "1" {
                    {
                        let policies = state.db.get_device_policies(device.pk).await.unwrap(); // TODO: Error handling

                        println!("POLICIES: {:?}", policies); // TODO

                        // TODO: This is an N + 1, avoid that + only deploy a certain number of policies at once so we don't overflow the SyncML body
                        for policy in policies {
                            let latest_deploy = state
                                .db
                                .get_policy_latest_version(policy.pk)
                                .await
                                .unwrap()
                                .into_iter()
                                .nth(0)
                                .unwrap(); // TODO: Error handling

                            info!(
                                "Deploying policy '{}' of version '{}' to device '{}'",
                                policy.pk, latest_deploy.pk, device.pk
                            );

                            let configurations: HashMap<String, Configuration> =
                                serde_json::from_value(latest_deploy.data.0).unwrap();
                            // TODO: Error handling

                            let mut windows_entries = HashMap::new();
                            for (configuration_key, configuration) in configurations {
                                match configuration {
                                    Configuration::Windows(windows) => match windows {
                                        WindowsConfiguration::Custom { custom } => {
                                            for entry in custom {
                                                windows_entries.insert(
                                                    entry.oma_uri.clone(),
                                                    (configuration_key.clone(), entry),
                                                );
                                            }
                                        }
                                    },
                                    // Skip anything that's not for Windows
                                    Configuration::Apple(_)
                                    | Configuration::Android(_)
                                    | Configuration::Script(_) => {}
                                }
                            }

                            // TODO: How do we deal with conflicting configurations being set across different policies???

                            for (_, (configuration_key, entry)) in windows_entries {
                                info!(
                                    "Deploying key '{}' of deploy '{}'",
                                    configuration_key, latest_deploy.pk
                                );

                                // TODO: Do a proper diff to work out the type of SyncML command should be `Add` or `Replace`.
                                // TODO: Also work out if any properties needing to be `Removed`
                                let cmd_id = next_cmd_id();
                                children.push(SyncBodyChild::Add(Add {
                                    cmd_id: cmd_id.clone(),
                                    meta: None,
                                    item: vec![Item {
                                        source: None,
                                        target: Some(Target::new(entry.oma_uri)),
                                        meta: Some(Meta {
                                            // TODO: Derive this from the configuration itself
                                            format: Some(Format {
                                                xmlns: "syncml:metinf".into(),
                                                value: "int".into(),
                                            }),
                                            ttype: Some("text/plain".into()),
                                        }),
                                        data: Some(match entry.value {
                                            AnyValue::String(value) => value,
                                            AnyValue::Int(value) => value.to_string(),
                                            AnyValue::Bool(value) => value.to_string(),
                                            AnyValue::Float(value) => value.to_string(),
                                        }),
                                    }],
                                }));

                                // TODO: Do this in a bulk insert
                                // TODO: We should probs do this last so that any error wouldn't cause the policy to be marked as being sent when it was not.
                                state
                                    .db
                                    .update_policy_deploy_status(
                                        latest_deploy.pk,
                                        configuration_key.clone(),
                                        "sent".into(),
                                        Serialized(serde_json::Value::Null),
                                    )
                                    .await
                                    .unwrap(); // TODO: Error handling

                                // TODO: Do this in parallel with the last update?
                                state
                                    .db
                                    .set_windows_ephemeral_state(
                                        cmd.hdr.session_id.as_str(),
                                        cmd.hdr.msg_id.clone(),
                                        cmd_id.as_str().into(),
                                        latest_deploy.pk,
                                        configuration_key,
                                    )
                                    .await
                                    .unwrap(); // TODO: Error handling
                            }
                        }
                    }

                    let actions = state.db.queued_device_actions(device.pk).await.unwrap(); // TODO: Error handling
                    for action in actions {
                        // TODO: Can we make this export as a Rust enum so it's typesafe??
                        match &*action.action {
                            "restart" => {
                                // TODO: "User" not supported. Does this matter for us with AAD enrollment???

                                // TODO: This is 406'ing and idk why it copies a Fleet doc and the MDM docs so it should be valid.
                                // children.push(SyncBodyChild::Exec(Exec {
                                //     cmd_id: next_cmd_id(),
                                //     meta: None,
                                //     item: Item {
                                //         source: None,
                                //         target: Some(Target::new(
                                //             "./Device/Vendor/MSFT/Reboot/RebootNow",
                                //         )),
                                //         meta: Some(Meta {
                                //             format: Some(Format {
                                //                 xmlns: "syncml:metinf".into(),
                                //                 value: "null".into(),
                                //             }),
                                //             ttype: Some("text/plain".into()),
                                //         }),
                                //         data: Some("".into()),
                                //     },
                                // }));

                                // children.push(SyncBodyChild::Replace(Replace {
                                //     cmd_id: next_cmd_id(),
                                //     meta: None,
                                //     item: vec![Item {
                                //         source: None,
                                //         target: Some(Target::new(
                                //             "./Vendor/MSFT/Reboot/Schedule/Single",
                                //         )),
                                //         meta: Some(Meta {
                                //             format: Some(Format {
                                //                 xmlns: "syncml:metinf".into(),
                                //                 value: "chr".into(),
                                //             }),
                                //             ttype: Some("text/plain".into()),
                                //         }),
                                //         data: Some("2024-03-10T01:50:00".into()),
                                //     }],
                                // }));

                                // children.push(SyncBodyChild::Add(Add {
                                //     cmd_id: next_cmd_id(),
                                //     meta: None,
                                //     item: vec![Item {
                                //         source: None,
                                //         target: Some(Target::new(
                                //             "./Vendor/MSFT/Personalization/DesktopImageUrl",
                                //         )),
                                //         meta: Some(Meta {
                                //             format: Some(Format {
                                //                 xmlns: "syncml:metinf".into(),
                                //                 value: "chr".into(),
                                //             }),
                                //             ttype: Some("text/plain".into()),
                                //         }),
                                //         data: Some("https://github.com/HaoHoo/WinMDM/blob/master/resource/desktop.jpg".into()),
                                //     }],
                                // }));
                                // children.push(SyncBodyChild::Replace(Replace {
                                //     cmd_id: next_cmd_id(),
                                //     meta: None,
                                //     item: vec![Item {
                                //         source: None,
                                //         target: Some(Target::new(
                                //             "./Vendor/MSFT/Personalization/DesktopImageUrl",
                                //         )),
                                //         meta: Some(Meta {
                                //             format: Some(Format {
                                //                 xmlns: "syncml:metinf".into(),
                                //                 value: "chr".into(),
                                //             }),
                                //             ttype: Some("text/plain".into()),
                                //         }),
                                //         data: Some("https://github.com/HaoHoo/WinMDM/blob/master/resource/desktop.jpg".into()),
                                //     }],
                                // }));

                                // TODO: 405
                                // children.push(SyncBodyChild::Replace(Replace {
                                //     cmd_id: next_cmd_id(),
                                //     meta: None,
                                //     item: vec![Item {
                                //         source: None,
                                //         target: Some(Target::new(
                                //             "./Device/Vendor/MSFT/Policy/Config/Camera/AllowCamera",
                                //         )),
                                //         meta: Some(Meta {
                                //             format: Some(Format {
                                //                 xmlns: "syncml:metinf".into(),
                                //                 value: "int".into(),
                                //             }),
                                //             ttype: Some("text/plain".into()),
                                //         }),
                                //         data: Some("0".into()),
                                //     }],
                                // }));

                                // This works cause it's user scoped.
                                // children.push(SyncBodyChild::Add(Add {
                                //     cmd_id: next_cmd_id(),
                                //     meta: None,
                                //     item: vec![Item {
                                //         source: None,
                                //         target: Some(Target::new(
                                //             "./User/Vendor/MSFT/Policy/Config/Education/AllowGraphingCalculator",
                                //         )),
                                //         meta: Some(Meta {
                                //             format: Some(Format {
                                //                 xmlns: "syncml:metinf".into(),
                                //                 value: "int".into(),
                                //             }),
                                //             ttype: Some("text/plain".into()),
                                //         }),
                                //         data: Some("0".into()),
                                //     }],
                                // }));

                                // TODO: Deal with result and mark as done so it doesn't reboot on every checkin.
                            }
                            "shutdown" => todo!(),
                            "lost" => todo!(),
                            "wipe" => todo!(),
                            // "retire",
                            action => error!("Unknown device action queued: {}", action),
                        }
                    }
                }

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
                        children,
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
                    .into_response()
            },
        ),
    )
}

fn authenticate(
    root_cert: &X509Certificate<'static>,
    info: ConnectInfoTy,
) -> Option<(String, String)> {
    let Some(certs) = info.client_cert else {
        debug!("No client certificate provided");
        return None;
    };

    let first = certs.first();
    let Some(cert) = first else {
        debug!("No client certificate provided");
        return None;
    };

    let (_, cert) = X509Certificate::from_der(&cert).unwrap(); // TODO: Error handling

    let Ok(_) = cert.verify_signature(Some(root_cert.public_key())) else {
        debug!("Client certificate was not signed by Mattrax!");
        return None;
    };

    // TODO: Error handling
    let device_id = String::from_utf8(
        cert.extensions_map()
            .unwrap()
            .get(&Oid::from(MICROSOFT_DEVICE_ID_EXTENSION).unwrap())
            .unwrap()
            .value
            .to_vec(),
    )
    .unwrap();

    let common_name = cert
        .subject()
        .iter_common_name()
        .nth(0)
        .unwrap()
        .attr_value()
        .as_string()
        .unwrap(); // TODO: Error handling

    if !cert.validity().is_valid() {
        info!("Client certificate for device '{}' has expired", device_id);
    }

    Some((common_name, device_id))
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
