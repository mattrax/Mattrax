use std::process;

use mx_db::Db;
use tokio::task::JoinSet;
use tracing::error;

use crate::config::{ConfigManager, Node};

/// Manage updating the Mattrax binary.
///
/// This will coordinate updates through the database, and also handle graceful restarts.
pub struct UpdateManager {
    // When dropped this will abort tasks
    handle: JoinSet<()>,
}

impl UpdateManager {
    pub fn new(db: Db, config: ConfigManager) -> Self {
        // TODO: Stop startup and update the node if required

        let mut handle = JoinSet::new();

        handle.spawn({
            let config = config.clone();
            async move {
                config
                    .subscribe(|cfg| {
                        if cfg.desired_version != env!("GIT_HASH") {
                            // TODO: We need to update
                            println!("TODO: Update required");
                        }
                    })
                    .await;
            }
        });

        handle.spawn(async move {
            let node_id = config.local().node_id.clone();

            loop {
                // TODO: Error handling
                let Some(node) = db
                    .get_node(node_id.clone())
                    .await
                    .unwrap()
                    .into_iter()
                    .next()
                else {
                    // TODO: We should have `mattrax reset` command maybe to remove the `LocalConfig` as an easy fix for this.
                    error!("The current node ({node_id}) does not exist in the database!");
                    error!("Something went fatally wrong, exiting...");
                    process::exit(1); // TODO: Graceful shutdown
                };

                let node = serde_json::from_slice::<Node>(&node.value).unwrap();

                let desired_version = config.get().desired_version.clone();
                if node.version != desired_version {
                    println!(
                        "TODO: Update required: {:?} -> {:?}",
                        node.version,
                        config.get().desired_version
                    );
                }

                // TODO: Timeout

                // TODO: Trigger self-update (blocking startup) if not on desired version

                break;
            }
        });

        Self { handle }
    }

    fn do_update(&self) {
        // TODO: Download binary

        // TODO: Startup new instance and check config

        // TODO: Gracefully drain traffic
        // TODO: Switch over tcp listener
    }
}
