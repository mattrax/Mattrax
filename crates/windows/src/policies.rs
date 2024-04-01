use std::collections::HashMap;

use ms_mdm::{SyncBodyChild, SyncML};
use mx_db::{Db, GetDeviceResult};
use mx_dmvalue::DmValue;
use mx_graph::{ConflictResolutionStrategy, Deploy, Graph};
use mx_policy::{windows::WindowsConfiguration, Configuration};

// TODO: Policies
// - get scoped groups
//     - get policies
//       - get latest versions
//     - merge each version into the graph
//     - store the graph
// - get policies for device
//      - merge each group into the graph
//      - merge the extras into the graph
// - apply the graph

pub(crate) async fn handler(db: &Db, device: &GetDeviceResult, cmd: &SyncML) -> Vec<SyncBodyChild> {
    // TODO: db.get_device_directly_scoped_policies

    let result = db.get_device_groups(device.pk).await.unwrap();

    println!("{:?}", result); // TODO

    let mut graph = Graph::default();

    for group in result {
        println!("GROUP {:?} {:?}", group.id, group.name); // TODO

        // TODO: Can we avoid N+1 queries here or is it fine cause this will be cached???
        let deploys = db.get_group_policy_deploys(group.pk).await.unwrap();

        // println!("{:?}", policies); // TODO

        for deploy in deploys {
            println!("{:?} {:?}", group.pk, deploy.pk); // TODO

            graph.add(render_deploy_for_windows(
                deploy.pk,
                deploy
                    .priority
                    .try_into()
                    .expect("MySQL 'UNSIGNED TINYINT' won't overflow u8"),
                deploy.data.0,
            ));
        }
    }

    // TODO: Join graph of group with device's graph and make sure the devices graph wins (maybe without needing to store them together???)

    println!("\n{:#?}", graph); // TODO

    vec![]
}

fn render_deploy_for_windows(deploy_pk: u64, priority: u8, data: serde_json::Value) -> Deploy {
    let configurations: HashMap<String, Configuration> =
        // TODO: Error handling
        serde_json::from_value(data).unwrap();

    let windows_configurations = configurations
        .into_iter()
        .filter_map(|(key, configuration)| match configuration {
            Configuration::Windows(windows) => Some((key, windows)),
            // Skip anything that's not for Windows
            Configuration::Apple(_) | Configuration::Android(_) | Configuration::Script(_) => None,
        });

    let mut deploy = Deploy {
        pk: deploy_pk,
        priority,
        configuration: Default::default(),
    };

    for (key, config) in windows_configurations {
        // TODO: Probs break this render logic out into another crate
        match config {
            WindowsConfiguration::PolicyConfigBrowserHomePages { homepages } => {
                let mut result = String::new();
                for value in homepages {
                    result.push('<');
                    result.push_str(&value);
                    result.push('>');
                }

                deploy.configuration.insert(
                    "./User/Vendor/MSFT/Policy/Config/Education/AllowGraphingCalculator".into(),
                    mx_graph::Configuration {
                        key: key.clone(),
                        value: DmValue::String(result),
                        conflict_resolution_strategy: ConflictResolutionStrategy::Conflict,
                    },
                );
            }
            WindowsConfiguration::PolicyEducationAllowGraphingCalculator {
                allow_graphing_calculator,
            } => {
                deploy.configuration.insert(
                    "./User/Vendor/MSFT/Policy/Config/Education/AllowGraphingCalculator".into(),
                    mx_graph::Configuration {
                        key: key.clone(),
                        value: DmValue::Integer(allow_graphing_calculator as u64),
                        conflict_resolution_strategy: ConflictResolutionStrategy::InValueOrder(
                            vec![DmValue::Integer(0), DmValue::Integer(1)],
                        ),
                    },
                );
            }
            WindowsConfiguration::Custom { custom } => {
                for custom in custom {
                    deploy.configuration.insert(
                        custom.oma_uri,
                        mx_graph::Configuration {
                            key: key.clone(),
                            value: custom.value.into(),
                            // We don't do automatic conflict resolution for custom configurations as we don't know what they are.
                            conflict_resolution_strategy: ConflictResolutionStrategy::Conflict,
                        },
                    );
                }
            }
        }
    }

    deploy
}
