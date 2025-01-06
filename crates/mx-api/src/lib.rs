//! The REST and MDM API for Mattrax.

mod api;
mod dm;
mod mount;
mod token;
mod utils;

use std::{sync::Arc, time::Duration};

use dm::device_ca::DeviceCA;
use sqlx::{
    migrate::{MigrateError, Migrator},
    mysql::MySqlPoolOptions,
    MySqlPool,
};

use tracing::{error, info};

pub static VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), "-", env!("GIT_HASH"));

/// The shared state for the API.
#[derive(Clone)]
pub struct Core {
    db: MySqlPool,
    device_ca: DeviceCA,
    secret: Arc<Vec<u8>>,
}

impl Core {
    pub fn new(database_url: &str, secret: Vec<u8>) -> Result<Self, sqlx::Error> {
        let db = MySqlPoolOptions::new()
            .max_connections(30)
            .min_connections(1)
            .test_before_acquire(false)
            .acquire_timeout(Duration::from_secs(7))
            .connect_lazy(database_url)?;

        let this = Self {
            db,
            device_ca: DeviceCA::new(),
            secret: Arc::new(secret),
        };
        DeviceCA::updater_task(this.clone());

        Ok(this)
    }

    /// Run migrations and ensure the database is ready.
    pub async fn migrate(&self) -> Result<(), MigrateError> {
        static MIGRATOR: Migrator = sqlx::migrate!();
        MIGRATOR.run(&self.db).await
    }

    /// Mount the Axum api
    pub fn mount(&self) -> axum::Router {
        mount::mount().with_state(self.clone())
    }

    /// Run any scheduled tasks.
    pub async fn cron(&self) {
        info!("Running cron...");

        let Ok(()) = dm::device_ca::refresh_device_ca(self)
            .await
            .map_err(|e| error!("Failed to refresh device CA: {}", e))
        else {
            return;
        };
    }
}
