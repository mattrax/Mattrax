use mx_db::Db;
use tokio::task::JoinHandle;

use crate::config::ConfigManager;

/// Manage updating the Mattrax binary.
///
/// This will coordinate updates through the database, and also handle graceful restarts.
pub struct UpdateManager {
    handle: JoinHandle<()>,
}

impl UpdateManager {
    pub fn new(db: Db, config: ConfigManager) -> Self {
        // let Some(node) = db
        //     .get_node(local_config.node_id.clone())
        //     .await
        //     .unwrap()
        //     .into_iter()
        //     .next()
        // else {
        //     // TODO: We should have `mattrax reset` command maybe to remove the `LocalConfig` as an easy fix for this.
        //     error!(
        //         "The current node ('{}') does not exist in the database!",
        //         local_config.node_id
        //     );
        //     process::exit(1);
        // };

        // TODO: Update the node on startup if required

        let handle = tokio::spawn(async move {
            config
                .subscribe(|cfg| {
                    if cfg.desired_version != env!("GIT_HASH") {
                        // TODO: We need to update
                        println!("TODO");
                    }
                })
                .await;
        });

        Self { handle }
    }

    fn do_update(&self) {
        // TODO: Startup new instance and check config

        // TODO: Gracefully drain traffic
        // TODO: Switch over tcp listener
    }
}

// pub async fn get_node(db: &Db, node_id: String) -> Result<Option<Node>, mysql_async::Error> {
//     let Some(node) = db.get_node(node_id.clone()).await?.into_iter().next() else {
//         // TODO: We should have `mattrax reset` command maybe to remove the `LocalConfig` as an easy fix for this.
//         error!("The current node ({node_id}) does not exist in the database!",);
//         process::exit(1);
//     };

//     Ok(None)
// }

// TODO: Update node's version if it doesn't match

// TODO: Check if current node exists in DB

// TODO: If required upgrade Mattrax version do it here

// TODO: Periodically - update ips/lastSeen in DB, check for required updates, check for changes to certs

// TODO: Subscribe to config changes

// TODO: Realtime updates for a group of nodes for Mattrax cloud
