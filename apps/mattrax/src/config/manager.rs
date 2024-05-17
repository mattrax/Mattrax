use std::{process, sync::Arc, time::Duration};

use arc_swap::ArcSwap;
use mx_db::Db;
use tokio::{sync::watch, task::JoinHandle};
use tracing::{error, info};

use super::{Config, LocalConfig};

struct Inner {
    local: LocalConfig,
    config: Arc<ArcSwap<Config>>,
    handle: JoinHandle<()>,
    watch: watch::Receiver<Config>,
}

/// takes care of managing the configuration for Mattrax.
///
/// This includes keeping the local configuration in sync with the database.
#[derive(Clone)]
pub struct ConfigManager(Arc<Inner>);

impl Drop for ConfigManager {
    fn drop(&mut self) {
        self.0.handle.abort();
    }
}

impl ConfigManager {
    pub fn new(db: Db, local: LocalConfig, config: Config) -> Result<Self, mysql_async::Error> {
        let (tx, watch) = watch::channel(config.clone());
        let config = Arc::new(ArcSwap::new(config.into()));
        let handle = tokio::spawn({
            let config = config.clone();
            async move {
                loop {
                    let offset = rand::random::<u8>(); // 255 % 60 = 15 so max of 15 seconds of jitter
                    tokio::time::sleep(Duration::from_secs(2 * 60 + (u64::from(offset) % 60)))
                        .await;

                    let Ok(result) = db
                        .get_config()
                        .await
                        .map(|result| match result
                            .into_iter()
                            .next() {
                                Some(config) => config,
                                None => {
                                    error!("Mattrax configuration not found in DB. Something has gone fatally wrong. Exiting...");
                                    process::exit(1); // TODO: Graceful shutdown not this
                                }
                            })
                        .map_err(|err| error!("Error getting Mattrax configuration from DB: {err}"))
                    else {
                        continue;
                    };

                    let Ok(result) = serde_json::from_slice(&result.value).map_err(|err| {
                        error!("Failed to deserialize Mattrax configuration: {err}");
                        error!("Something has gone fatally wrong. Exiting...");
                    }) else {
                        process::exit(1); // TODO: Graceful shutdown not this
                    };

                    if *config.load().clone() != result {
                        info!("Detected configuration change!");
                        config.store(Arc::new(result.clone()));
                        tx.send_replace(result);
                    }
                }
            }
        });

        Ok(Self(Arc::new(Inner {
            local,
            config,
            handle,
            watch,
        })))
    }

    pub fn local(&self) -> &LocalConfig {
        &self.0.local
    }

    pub fn get(&self) -> Arc<Config> {
        self.0.config.load().clone()
    }

    pub async fn subscribe(&self, mut cb: impl FnMut(Config)) {
        let mut watch = self.0.watch.clone();

        loop {
            let Ok(()) = watch.changed().await else {
                break;
            };
            cb(watch.borrow_and_update().clone());
        }
    }
}
