//! Core business logic for Mattrax.

use sqlx::{
    migrate::{MigrateError, Migrator},
    mysql::MySqlPoolOptions,
    MySqlPool,
};

mod identity;

pub use identity::*;
use tracing::debug;

pub static VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), "-", env!("GIT_HASH"));

static MIGRATOR: Migrator = sqlx::migrate!();

#[derive(Clone)]
pub struct Api {
    db: MySqlPool,
}

impl Api {
    pub fn new(database_url: &str) -> Result<Self, sqlx::Error> {
        let db = MySqlPoolOptions::new()
            // TODO: Tuning these parameters
            .max_connections(30)
            .min_connections(1)
            .connect_lazy(database_url)?;

        Ok(Self { db })
    }

    /// Run migrations and ensure the database is ready.
    pub async fn migrate(&self) -> Result<(), MigrateError> {
        MIGRATOR.run(&self.db).await
    }

    /// Run any scheduled tasks.
    pub async fn cron(&self) {
        debug!("Running cron...");

        // TODO
    }
}
