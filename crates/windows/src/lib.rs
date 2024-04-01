//! Windows MDM management handler

// TODO: Tracing instrumentation

use ms_mdm::{CmdId, CmdRef, Final, MsgRef, Status, SyncBody, SyncHdr, SyncML};
use mx_db::Db;
use rustls::pki_types::CertificateDer;
use tracing::info;
use x509_parser::certificate::X509Certificate;

mod actions;
mod authenticate;
mod policies;
mod results;

pub async fn handler(
    db: &Db,
    root_cert: &X509Certificate<'static>,
    body: String,
    client_cert: Option<CertificateDer<'_>>,
) -> String {
    let Some((upn, device_id)) = authenticate::handler(&root_cert, client_cert) else {
        // return StatusCode::UNAUTHORIZED.into_response();
        panic!("Unauthorized"); // TODO: Error handling
    };

    info!(
        "MDM Checkin from device '{}' as '{}'",
        device_id,
        upn.as_deref().unwrap_or("system")
    );

    let cmd = match SyncML::from_str(&body) {
        Ok(cmd) => cmd,
        Err(err) => {
            println!("\nBODY: {body}\n");
            panic!("{:?}", err); // TODO: Error handling
        }
    };

    let Some(device) = db.get_device(device_id).await.unwrap().into_iter().nth(0) else {
        // return StatusCode::NOT_FOUND.into_response(); // TODO: Proper SyncML error
        panic!("Device not found"); // TODO: Error handling
    };

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

    // TODO: Parallelize the body - So the DB queries can be done in parallel hence reducing the time taken

    println!("{:?}", cmd.hdr); // TODO
    let first_msg = cmd.hdr.msg_id == "1";
    // if first_msg {
    //     // db.update_device_lastseen(device.pk, Local::now().naive_utc())
    //     //     .await
    //     //     .unwrap(); // TODO: Error handling
    // }

    results::handler(&cmd).await;
    if cmd.hdr.msg_id == "1" {
        children.append(&mut policies::handler(&cmd).await);
    }
    children.append(&mut policies::handler(&cmd).await);

    // TODO: Deploy applications

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

    response.to_string().unwrap() // TODO: Error handling
}
