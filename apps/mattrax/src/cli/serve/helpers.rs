use std::process;

use mx_db::{migrations, Db};
use tracing::error;

use crate::config;

/// Constructs a database connection pool, runs migrations and pull's the Mattrax configuration.
pub async fn get_db_and_config(db_url: &str) -> (Db, Option<config::Config>) {
    let mut db = Db::new(db_url);

    let Ok(_) = db
        .get_conn()
        .await
        .map_err(|err| error!("Failed to connect to the database: {err}"))
    else {
        process::exit(1);
    };

    let Ok(_) = migrations::runner()
        .set_migration_table_name("_migrations")
        .run_async(&mut *db)
        .await
        .map_err(|err| error!("Failed to run migrations on database: {err}"))
    else {
        process::exit(1);
    };

    let Ok(config) = db
        .get_config()
        .await
        .map_err(|err| error!("Failed to get Mattrax configuration from DB: {err}"))
    else {
        process::exit(1);
    };

    let Ok(config) = config
        .into_iter()
        .next()
        .map(|config| serde_json::from_slice(&config.value))
        .transpose()
        .map_err(|err| error!("Failed to deserialize Mattrax configuration: {err}"))
    else {
        process::exit(1);
    };

    (db, config)
}
