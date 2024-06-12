use std::collections::{HashMap, HashSet};

use ms_mdm::{
    Add, Atomic, CmdId, Delete, Format, Item, Meta, Replace, SyncBodyChild, SyncML, Target,
};
use mx_db::{Db, GetDeviceResult};
use mx_db::{GetPendingDeployStatusesResult, GetPolicyDataForCheckinResult};
use mx_policy::{DmValue, PolicyData};

// TODO: Error handling
// TODO: Support resolving soft conflicts using information from DFF files.
// TODO: Take into account `scope`
// TODO: User vs device scoping

pub(crate) async fn handler(
    db: &Db,
    device: &GetDeviceResult,
    _cmd: &SyncML,
    final_cmd_id: CmdId,
) -> Vec<SyncBodyChild> {
    let scope = db.get_policy_data_for_checkin(device.pk).await.unwrap();
    let pending_deploy_statuses = db.get_pending_deploy_statuses(device.pk).await.unwrap();

    println!("SCOPE: {:?}", scope); // TODO

    let result = resolve(scope, pending_deploy_statuses);

    println!("RESULT: {:#?}", result); // TODO

    // TODO: Merge this into the loop below so we can abort sending to the device when the payload gets too big. (cause as long as we don't report a status for it we are good)
    // TODO: Insert many here - https://github.com/mattrax/Mattrax/issues/363
    let mut deployed_deploys = result.result.keys().copied().collect::<HashSet<_>>();
    {
        for (_, deploy_pks) in result.conflicts.iter() {
            for deploy_pk in deploy_pks {
                deployed_deploys.remove(&deploy_pk);

                db.create_policy_deploy_status(
                    device.pk,
                    *deploy_pk,
                    Some(serde_json::to_string(&result.conflicts).unwrap()),
                )
                .await
                .unwrap();
            }
        }

        for deploy_pk in deployed_deploys {
            db.create_policy_deploy_status(device.pk, deploy_pk, None)
                .await
                .unwrap();
        }
    }

    // TODO: Do this helper better
    let mut cmd_id = 0;
    let mut next_cmd_id = move || {
        cmd_id += 1;
        CmdId::new(format!("{}", cmd_id)).expect("can't be zero")
    };

    let mut body = vec![];
    for (deploy_pk, nodes) in result.result {
        let mut children = vec![];

        for (uri, node) in nodes {
            // TODO: When `children` gets big enough we should be able to stop sending and stop reporting status.

            match node {
                ManagementNode::Add { deploy_pk, value } => {
                    // TODO: Can a single `Add` holding multiple items be enough? Does it provide atomic energy???
                    children.push(
                        Add {
                            cmd_id: next_cmd_id(),
                            meta: None,
                            item: vec![Item {
                                source: None,
                                target: Some(Target::new(uri)),
                                meta: Some(Meta {
                                    format: Some(Format {
                                        xmlns: "syncml:metinf".into(),
                                        value: match value {
                                            DmValue::String(_) => "chr".into(),
                                            DmValue::Integer(_) => "int".into(),
                                            value => todo!("{value:?} not supported"),
                                        },
                                    }),
                                    ttype: None,
                                }),
                                data: Some(match value {
                                    DmValue::String(v) => v.into(),
                                    DmValue::Integer(v) => v.to_string(),
                                    // TODO: Fix this
                                    value => todo!("{value:?} not supported"),
                                }),
                            }],
                        }
                        .into(),
                    );
                }
                ManagementNode::Replace {
                    deploy_pk, value, ..
                } => {
                    // TODO: Can a single `Replace` holding multiple items be enough? Does it provide atomic energy???
                    children.push(
                        Replace {
                            cmd_id: next_cmd_id(),
                            meta: None,
                            item: vec![Item {
                                source: None,
                                target: Some(Target::new(uri)),
                                meta: Some(Meta {
                                    format: Some(Format {
                                        xmlns: "syncml:metinf".into(),
                                        value: match value {
                                            DmValue::String(_) => "chr".into(),
                                            DmValue::Integer(_) => "int".into(),
                                            value => todo!("{value:?} not supported"),
                                        },
                                    }),
                                    ttype: None,
                                }),
                                data: match value {
                                    DmValue::String(v) => v.into(),
                                    DmValue::Integer(v) => Some(v.to_string()),
                                    // TODO: Fix this
                                    value => todo!("{value:?} not supported"),
                                },
                            }],
                        }
                        .into(),
                    );
                }
                ManagementNode::Delete { .. } => {
                    // TODO: Can a single `Replace` holding multiple items be enough? Does it provide atomic energy???
                    children.push(
                        Delete {
                            cmd_id: next_cmd_id(),
                            meta: None,
                            item: vec![Item {
                                source: None,
                                target: Some(Target::new(uri)),
                                meta: None,
                                data: None,
                            }],
                        }
                        .into(),
                    );
                }
            }
        }

        println!("{deploy_pk} {children:?}");

        if !children.is_empty() {
            // TODO: We are deploying everything in one atomic that's problematic can we split this down into one for each policy?
            body.push(SyncBodyChild::Atomic(Atomic {
                cmd_id: CmdId::new(format!("deploy|{deploy_pk}")).expect("trust me bro"),
                meta: None,
                children,
            }))
        }
    }

    body
}

fn resolve(
    scoped_policies: Vec<GetPolicyDataForCheckinResult>,
    pending_deploy_statuses: Vec<GetPendingDeployStatusesResult>,
) -> ResolveResult {
    // A global record of all the OMA DM nodes that were deployed to the device.
    // We apply conflict resolution to this and then transpose it into a per-deploy map (`result`).
    let mut desired = HashMap::new();
    // A record of all the OMA DM nodes which are in conflict.
    // TODO: Make it a tree which would probs be more storage efficient???
    let mut conflicts: HashMap<String, Vec<u64>> = HashMap::new();
    // The final result of the resolution transposed into a per-deploy map from `desired`
    let mut result: HashMap<u64, HashMap<String, ManagementNode>> = HashMap::new();

    // TODO: For anything in `pending_deploy_statuses` we don't really know if the payload was commit to the device or not so we need to take that into account.

    // Filter out unchanged policies and deserialize the policy data.
    let policy_content = scoped_policies
        .into_iter()
        .filter_map(|policy| {
            // Note: If we skip stuff that doesn't change here we will have issues because another policy could change resulting in the conflict resolution state changing.

            let latest =
                serde_json::from_value::<PolicyData>(policy.latest_deploy.data.0.clone()).unwrap();
            let last = policy
                .last_deploy
                .as_ref()
                .map(|v| serde_json::from_value::<PolicyData>(v.data.0.clone()).unwrap());

            let conflicts = policy
                .last_deploy
                .as_ref()
                .and_then(|v| v.conflicts.as_ref())
                .map(|v| serde_json::from_value::<HashMap<String, Vec<u64>>>(v.0.clone()).unwrap());

            Some((policy, latest, last, conflicts))
        })
        .collect::<Vec<_>>();

    // We mark all OMA URI nodes that were previously deployed to device to be deleted.
    // This will cause them to be removed unless they appear in the latest deploy.
    //
    // This mechanism also important as it's used to determine whether a `Replace` is required or not (based on the existence of the node in `desired`).
    for (_, _, last, conflicts) in policy_content.iter() {
        for (key, children) in last.as_ref().map(|v| &v.windows).into_iter().flatten() {
            for (child_key, value) in children {
                let value: DmValue = value.clone().into();

                // We mark all node's that were previously deployed as `Delete` so they are removed.
                desired.insert(
                    format!("{}{}", key, child_key),
                    ManagementNode::Delete {
                        deploy_pk: todo!(),
                        value,
                    },
                );
            }
        }

        // If a hard conflict was observed in the last deploy, then we unset the deleted node.
        // This ensures that if the node was not actually set an add will be performed instead of a replace.
        for (key, _) in conflicts.as_ref().into_iter().flatten() {
            desired.remove(key);
        }
    }

    for (policy, latest, _, _) in policy_content {
        // We ensure all the deploys get a corresponding entry in the result.
        result.insert(policy.latest_deploy.pk, Default::default());

        for (key, children) in latest.windows {
            for (child_key, desired_value) in children {
                let key = format!("{}{}", key, child_key);
                let desired_value: DmValue = desired_value.into();

                match desired.get(&key) {
                    Some(ManagementNode::Delete { deploy_pk, value }) => {
                        desired.insert(
                            key,
                            ManagementNode::Replace {
                                deploy_pk: policy.latest_deploy.pk,
                                changed: &desired_value != value,
                                value: desired_value,
                            },
                        );
                    }
                    Some(ManagementNode::Add { deploy_pk, value })
                    | Some(ManagementNode::Replace {
                        deploy_pk, value, ..
                    }) => {
                        // If the values match then we don't need to do anything.
                        if *value == desired_value {
                            continue;
                        }

                        conflicts
                            .entry(key)
                            .and_modify(|v: &mut Vec<u64>| v.push(policy.latest_deploy.pk))
                            .or_insert_with(|| vec![*deploy_pk, policy.latest_deploy.pk]);
                    }
                    None => {
                        desired.insert(
                            key,
                            ManagementNode::Add {
                                deploy_pk: policy.latest_deploy.pk,
                                value: desired_value,
                            },
                        );
                    }
                };
            }
        }
    }

    // Finally, we cleanup all conflicted nodes.
    // We have to keep them around as we do a value comparison to determine if they are conflicted or not.
    for (key, _) in conflicts.iter() {
        desired.remove(key);
    }

    // We map `desired` which is a "global" map of all nodes to a per-deploy map.
    // This is so each deploy can be sent to the device individually and we can track it's status individually.
    for (uri, node) in desired {
        let deploy_pk = node.deploy_pk();
        let entry = result.entry(deploy_pk).or_default();

        // We filter out all nodes that haven't changed value since the last checkin
        if matches!(node, ManagementNode::Replace { changed: false, .. }) {
            continue;
        }

        entry.insert(uri, node);
    }

    ResolveResult { result, conflicts }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ManagementNode {
    Add {
        deploy_pk: u64,
        /// The value of the management node.
        value: DmValue,
    },
    Replace {
        deploy_pk: u64,
        /// The value of the management node.
        value: DmValue,
        // Has this value changed from the last deploy?
        // We still mark this node as a `Replace` regardless so conflict resolution can be done correctly.
        // Any `ManagementNode` with this set to `true` should not be sent to the device.
        changed: bool,
    },
    Delete {
        deploy_pk: u64,
        // The last known value of this management node.
        // This is used to derive the `changed` property in `Replace`.
        value: DmValue,
    },
}

impl ManagementNode {
    pub fn deploy_pk(&self) -> u64 {
        match self {
            ManagementNode::Add { deploy_pk, .. }
            | ManagementNode::Replace { deploy_pk, .. }
            | ManagementNode::Delete { deploy_pk, .. } => *deploy_pk,
        }
    }
}

#[derive(Debug)]
struct ResolveResult {
    // All the OMA DM nodes which need to be applied to the current device to get it to the desired state.
    // This maps each deploy id to the map of OMA DM nodes that need to be applied.
    result: HashMap<u64, HashMap<String, ManagementNode>>,
    // A record of all the OMA DM nodes which are in conflict.
    // We need this for future checkins to know the state of the device and also for the UI.
    conflicts: HashMap<String, Vec<u64>>,
}
