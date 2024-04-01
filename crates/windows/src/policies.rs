use std::collections::HashMap;

use ms_mdm::{SyncBodyChild, SyncML};
use mx_db::{Db, GetDeviceResult};
use mx_graph::Graph;
use mx_policy::Configuration;

pub(crate) async fn handler(db: &Db, device: &GetDeviceResult, cmd: &SyncML) -> Vec<SyncBodyChild> {
    // TODO: db.get_device_directly_scoped_policies

    let result = db.get_device_groups(device.pk).await.unwrap();

    println!("{:?}", result); // TODO

    let graph = Graph::default();

    for group in result {
        println!("GROUP {:?} {:?}", group.id, group.name); // TODO

        // TODO: Can we avoid N+1 queries here or is it fine cause this will be cached???
        let deploys = db.get_group_policy_deploys(group.pk).await.unwrap();

        // println!("{:?}", policies); // TODO

        for deploy in deploys {
            println!("{:?} {:?}", group.pk, deploy.pk); // TODO

            let _ = render_deploy_for_windows(deploy.pk, deploy.data.0);

            // TODO: Add to graph
        }
    }

    println!("{:?}", graph); // TODO

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

    vec![]
}

fn render_deploy_for_windows(deploy_pk: u64, data: serde_json::Value) {
    let configurations: HashMap<String, Configuration> =
    // TODO: Error handling
        serde_json::from_value(data).unwrap();

    let y = configurations
        .into_iter()
        .filter_map(|(key, configuration)| match configuration {
            Configuration::Windows(windows) => Some((key, windows)),
            // Skip anything that's not for Windows
            Configuration::Apple(_) | Configuration::Android(_) | Configuration::Script(_) => None,
        })
        .collect::<HashMap<_, _>>();

    println!("{:?}", y); // TODO

    // TODO: Result
}
