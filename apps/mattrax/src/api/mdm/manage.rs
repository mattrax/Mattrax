use std::sync::Arc;

use axum::{routing::post, Router};

use crate::api::Context;

pub fn mount(_state: Arc<Context>) -> Router<Arc<Context>> {
    Router::new().route(
        "/Manage.svc",
        post(|| async move {
            // TODO: Check `MS-Signature` header - base64 CMS detached + signature SHA-2 hash & check timestamp
            // TODO: Decode `Mode` from URL params
            // TODO: `Authorization` + `Bearer` token for AzureAD user account
            // TODO: Mutual TLS authentication

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

            todo!();
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
