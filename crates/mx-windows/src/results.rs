use ms_mdm::{SyncBodyChild, SyncML};

pub(crate) async fn handler(cmd: &SyncML) {
    for child in cmd.child.children.iter() {
        println!("CHILD: {:#?}\n\n", child);

        match child {
            SyncBodyChild::Replace(cmd) => {
                for _item in cmd.item.iter() {
                    // println!("{:#?} {:?} {:?}", item, item.source, item.data);
                    // TODO: Do a insert many instead of multiple inserts
                    // state.db.set_device_data(
                    //     &cmd.cmd_id,
                    //     &item.source,
                    //     &item.data,
                    // ).await.unwrap(); // TODO: Error handling
                }
            }
            SyncBodyChild::Status(_status) => {
                // let Ok(Some(deploy_status)) = state
                //     .db
                //     .get_windows_ephemeral_state(
                //         cmd.hdr.session_id.as_str(),
                //         status.msg_ref.as_str().into(),
                //         status.cmd_ref.as_str().into(),
                //     )
                //     .await
                //     .map(|v| v.into_iter().nth(0))
                // else {
                //     println!(
                //         "TODO: NO STATUS FOUND for {:?} {:?} {:?}",
                //         cmd.hdr.session_id, status.msg_ref, status.cmd_ref
                //     );
                //     continue;
                // };

                // // TODO: Tracing log
                // println!("\n\n\nYOOOOOOOO\n{:#?}\n", deploy_status);

                // state
                //     .db
                //     .update_policy_deploy_status(
                //         deploy_status.deploy_pk,
                //         device.pk,
                //         deploy_status.key,
                //         "success".into(), // TODO: Actually check the damn code & retry if a fix is easily possible
                //         // TODO: Could this be nullable and null means in-progress, idk how we would represent success then
                //         Serialized(json!({
                //             "status": status.data
                //         })),
                //     )
                //     .await
                //     .unwrap(); // TODO: Error handling

                // state
                //     .db
                //     .delete_windows_ephemeral_state(
                //         cmd.hdr.session_id.as_str(),
                //         status.msg_ref.as_str().into(),
                //         status.cmd_ref.as_str().into(),
                //     )
                //     .await
                //     .unwrap(); // TODO: Error handling
            }
            _ => {}
        }
    }
}
