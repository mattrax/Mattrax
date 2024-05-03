use ms_mdm::{SyncBodyChild, SyncML};

pub(crate) async fn handler() -> Vec<SyncBodyChild> {
    // let actions = state.db.queued_device_actions(device.pk).await.unwrap(); // TODO: Error handling
    // for action in actions {
    //     // TODO: Can we make this export as a Rust enum so it's typesafe??
    //     match &*action.action {
    //         "restart" => {
    //             // TODO: "User" not supported. Does this matter for us with AAD enrollment???

    //             // TODO: This is 406'ing and idk why it copies a Fleet doc and the MDM docs so it should be valid.
    //             // children.push(SyncBodyChild::Exec(Exec {
    //             //     cmd_id: next_cmd_id(),
    //             //     meta: None,
    //             //     item: Item {
    //             //         source: None,
    //             //         target: Some(Target::new(
    //             //             "./Device/Vendor/MSFT/Reboot/RebootNow",
    //             //         )),
    //             //         meta: Some(Meta {
    //             //             format: Some(Format {
    //             //                 xmlns: "syncml:metinf".into(),
    //             //                 value: "null".into(),
    //             //             }),
    //             //             ttype: Some("text/plain".into()),
    //             //         }),
    //             //         data: Some("".into()),
    //             //     },
    //             // }));

    //             // children.push(SyncBodyChild::Replace(Replace {
    //             //     cmd_id: next_cmd_id(),
    //             //     meta: None,
    //             //     item: vec![Item {
    //             //         source: None,
    //             //         target: Some(Target::new(
    //             //             "./Vendor/MSFT/Reboot/Schedule/Single",
    //             //         )),
    //             //         meta: Some(Meta {
    //             //             format: Some(Format {
    //             //                 xmlns: "syncml:metinf".into(),
    //             //                 value: "chr".into(),
    //             //             }),
    //             //             ttype: Some("text/plain".into()),
    //             //         }),
    //             //         data: Some("2024-03-10T01:50:00".into()),
    //             //     }],
    //             // }));

    //             // children.push(SyncBodyChild::Add(Add {
    //             //     cmd_id: next_cmd_id(),
    //             //     meta: None,
    //             //     item: vec![Item {
    //             //         source: None,
    //             //         target: Some(Target::new(
    //             //             "./Vendor/MSFT/Personalization/DesktopImageUrl",
    //             //         )),
    //             //         meta: Some(Meta {
    //             //             format: Some(Format {
    //             //                 xmlns: "syncml:metinf".into(),
    //             //                 value: "chr".into(),
    //             //             }),
    //             //             ttype: Some("text/plain".into()),
    //             //         }),
    //             //         data: Some("https://github.com/HaoHoo/WinMDM/blob/master/resource/desktop.jpg".into()),
    //             //     }],
    //             // }));
    //             // children.push(SyncBodyChild::Replace(Replace {
    //             //     cmd_id: next_cmd_id(),
    //             //     meta: None,
    //             //     item: vec![Item {
    //             //         source: None,
    //             //         target: Some(Target::new(
    //             //             "./Vendor/MSFT/Personalization/DesktopImageUrl",
    //             //         )),
    //             //         meta: Some(Meta {
    //             //             format: Some(Format {
    //             //                 xmlns: "syncml:metinf".into(),
    //             //                 value: "chr".into(),
    //             //             }),
    //             //             ttype: Some("text/plain".into()),
    //             //         }),
    //             //         data: Some("https://github.com/HaoHoo/WinMDM/blob/master/resource/desktop.jpg".into()),
    //             //     }],
    //             // }));

    //             // TODO: 405
    //             // children.push(SyncBodyChild::Replace(Replace {
    //             //     cmd_id: next_cmd_id(),
    //             //     meta: None,
    //             //     item: vec![Item {
    //             //         source: None,
    //             //         target: Some(Target::new(
    //             //             "./Device/Vendor/MSFT/Policy/Config/Camera/AllowCamera",
    //             //         )),
    //             //         meta: Some(Meta {
    //             //             format: Some(Format {
    //             //                 xmlns: "syncml:metinf".into(),
    //             //                 value: "int".into(),
    //             //             }),
    //             //             ttype: Some("text/plain".into()),
    //             //         }),
    //             //         data: Some("0".into()),
    //             //     }],
    //             // }));

    //             // This works cause it's user scoped.
    //             // children.push(SyncBodyChild::Add(Add {
    //             //     cmd_id: next_cmd_id(),
    //             //     meta: None,
    //             //     item: vec![Item {
    //             //         source: None,
    //             //         target: Some(Target::new(
    //             //             "./User/Vendor/MSFT/Policy/Config/Education/AllowGraphingCalculator",
    //             //         )),
    //             //         meta: Some(Meta {
    //             //             format: Some(Format {
    //             //                 xmlns: "syncml:metinf".into(),
    //             //                 value: "int".into(),
    //             //             }),
    //             //             ttype: Some("text/plain".into()),
    //             //         }),
    //             //         data: Some("0".into()),
    //             //     }],
    //             // }));

    //             // TODO: Deal with result and mark as done so it doesn't reboot on every checkin.
    //         }
    //         "shutdown" => todo!(),
    //         "lost" => todo!(),
    //         "wipe" => todo!(),
    //         // "retire",
    //         action => error!("Unknown device action queued: {}", action),
    //     }
    // }

    vec![]
}
