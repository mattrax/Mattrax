//! The REST and MDM API for Mattrax.

mod api;
mod dm;
mod mount;
mod utils;

use dm::device_ca::DeviceCA;
use sqlx::{
    migrate::{MigrateError, Migrator},
    mysql::MySqlPoolOptions,
    MySqlPool,
};

use tracing::info;

pub static VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), "-", env!("GIT_HASH"));

/// The shared state for the API.
#[derive(Clone)]
pub struct Core {
    db: MySqlPool,
    device_ca: DeviceCA,
}

impl Core {
    pub fn new(database_url: &str) -> Result<Self, sqlx::Error> {
        let db = MySqlPoolOptions::new()
            // TODO: Tuning these parameters
            .max_connections(30)
            .min_connections(1)
            .connect_lazy(database_url)?;

        let this = Self {
            db,
            device_ca: DeviceCA::new(),
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
        mount::mount(self.clone())
    }

    /// Run any scheduled tasks.
    pub async fn cron(&self) {
        info!("Running cron...");

        let this = self.clone();
        tokio::spawn(async move {
            dm::device_ca::refresh_device_ca(&this).await.unwrap();
        });

        dm::device_ca::refresh_device_ca(self).await.unwrap();

        // TODO: setup identity certificate and renew if required
        // TODO: Configuration for development with very-very short renew times
    }
}
