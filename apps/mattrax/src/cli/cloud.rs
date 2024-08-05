use std::path::PathBuf;

use crate::config::{ConfigManager, LocalConfig};

use super::{
    init::do_setup,
    serve::{helpers, serve_inner},
};

#[derive(clap::Args)]
#[command(about = "Run Mattrax Cloud instance.")]
pub struct Command;

impl Command {
    pub async fn run(&self, data_dir: PathBuf) {
        let db_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

        let (db, config) = loop {
            // TODO: Once `do_setup` is done we should be able to re-pull config without reinitialising the DB
            let (db, config) = helpers::get_db_and_config(&db_url).await;
            if let Some(config) = config {
                break (db, config);
            } else {
                do_setup(
                    &db,
                    (
                        "mdm.mattrax.app".into(),
                        "enterpriseenrollment.mattrax.app".into(),
                    ),
                )
                .await;
            }
        };

        let config_manager = ConfigManager::new(
            db.clone(),
            LocalConfig {
                node_id: "cloud".into(),
                db_url,
            },
            config,
        )
        .unwrap();

        serve_inner(None, data_dir, db, config_manager).await;
    }
}
