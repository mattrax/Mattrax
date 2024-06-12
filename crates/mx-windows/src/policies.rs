use std::collections::{HashMap, HashSet};

use ms_mdm::{
    Add, Atomic, CmdId, Delete, Format, Item, Meta, Replace, SyncBodyChild, SyncML, Target,
};
use mx_db::GetPolicyDataForCheckinResult;
use mx_db::{Db, GetDeviceResult};
use mx_policy::{DmValue, PolicyData};

// TODO: Error handling
// TODO: Support resolving soft conflicts using information from DFF files.
// TODO: Take into account `scope`

pub(crate) async fn handler(
    db: &Db,
    device: &GetDeviceResult,
    _cmd: &SyncML,
    final_cmd_id: CmdId,
) -> Vec<SyncBodyChild> {
    let scope = db.get_policy_data_for_checkin(device.pk).await.unwrap();

    println!("SCOPE: {:?}", scope); // TODO

    let mut result = resolve(scope);

    println!("RESULT: {:#?}", result); // TODO

    // TODO: Turn this into an insert_many so it's not slow.
    {
        for (_, deploy_pks) in result.conflicts.iter() {
            for deploy_pk in deploy_pks {
                result.deployed_deploys.remove(&deploy_pk);

                db.create_policy_deploy_status(
                    device.pk,
                    *deploy_pk,
                    "pending".into(),
                    Some(serde_json::to_string(&result.conflicts).unwrap()),
                )
                .await
                .unwrap();
            }
        }

        for deploy_pk in result.deployed_deploys {
            db.create_policy_deploy_status(device.pk, deploy_pk, "pending".into(), None)
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

    let mut children = vec![];
    for (uri, node) in result.desired {
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
            ManagementNode::Replace { deploy_pk, value } => {
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
                                // TODO: Fix this
                                value => todo!("{value:?} not supported"),
                            },
                        }],
                    }
                    .into(),
                );
            }
            ManagementNode::Delete => {
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

    println!("{children:?}");

    let mut result = vec![];
    if !children.is_empty() {
        result.push(SyncBodyChild::Atomic(Atomic {
            cmd_id: final_cmd_id,
            meta: None,
            children,
        }))
    }
    result
}

fn resolve(scoped_policies: Vec<GetPolicyDataForCheckinResult>) -> ResolveResult {
    // TODO: // A record of all the OMA DM nodes which need to be applied to the current device to get it to the desired state.
    let mut desired = HashMap::new();
    // TODO
    // TODO: Make it a tree which would probs be more storage efficient???
    let mut conflicts: HashMap<String, Vec<u64>> = HashMap::new();
    // TODO
    let mut deployed_deploys: HashSet<u64> = HashSet::new();

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
            for (child_key, _) in children {
                // We mark all node's that were previously deployed as `Delete` so they are removed.
                desired.insert(format!("{}{}", key, child_key), ManagementNode::Delete);
            }
        }

        // If a hard conflict was observed in the last deploy, then we unset the deleted node.
        // This ensures that if the node was not actually set an add will be performed instead of a replace.
        for (key, _) in conflicts.as_ref().into_iter().flatten() {
            desired.remove(key);
        }
    }

    for (policy, latest, _, _) in policy_content {
        deployed_deploys.insert(policy.latest_deploy.pk);

        for (key, children) in latest.windows {
            for (child_key, desired_value) in children {
                let key = format!("{}{}", key, child_key);
                let desired_value: DmValue = desired_value.into();

                match desired.get(&key) {
                    Some(ManagementNode::Delete) => {
                        // TODO: We should skip if the value is the same as the last deploy.

                        desired.insert(
                            key,
                            ManagementNode::Replace {
                                deploy_pk: policy.latest_deploy.pk,
                                value: desired_value,
                            },
                        );
                    }
                    Some(ManagementNode::Add { deploy_pk, value })
                    | Some(ManagementNode::Replace { deploy_pk, value }) => {
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

    ResolveResult {
        desired,
        conflicts,
        deployed_deploys,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ManagementNode {
    Add { deploy_pk: u64, value: DmValue },
    Replace { deploy_pk: u64, value: DmValue },
    Delete,
}

#[derive(Debug)]
struct ResolveResult {
    desired: HashMap<String, ManagementNode>,
    conflicts: HashMap<String, Vec<u64>>,
    deployed_deploys: HashSet<u64>,
}
