use std::path::Path;

use tracing_appender::{
    non_blocking::{NonBlocking, WorkerGuard},
    rolling::{RollingFileAppender, Rotation},
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, Layer};

pub fn setup(data_dir: &Path, crate_name: &'static str) -> WorkerGuard {
    // Set a default if the user hasn't set an override
    if std::env::var("RUST_LOG") == Err(std::env::VarError::NotPresent) {
        let level = if cfg!(debug_assertions) {
            "debug"
        } else {
            "info"
        };

        std::env::set_var("RUST_LOG", format!("info,{crate_name}={level}"));
    }

    let (logfile, guard) = NonBlocking::new(
        RollingFileAppender::builder()
            .filename_prefix("mttx")
            .filename_suffix("log")
            .rotation(Rotation::DAILY)
            .max_log_files(7)
            .build(data_dir.join("logs"))
            .expect("Error setting up log file!"),
    );

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(false)
                .with_file(true)
                .with_line_number(true)
                .with_ansi(false)
                .with_writer(logfile)
                .with_filter(EnvFilter::from_default_env()),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(false)
                .with_file(true)
                .with_line_number(true)
                .with_writer(std::io::stdout)
                .with_filter(EnvFilter::from_default_env()),
        )
        .init();

    guard
}
