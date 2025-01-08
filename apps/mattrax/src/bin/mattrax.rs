//! The standard entrypoint for Mattrax.

use tokio::{net::TcpListener, signal};
use tracing::{error, info, level_filters::LevelFilter};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> Result<(), ()> {
    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(
            EnvFilter::builder()
                .with_default_directive(
                    if cfg!(debug_assertions) {
                        LevelFilter::DEBUG
                    } else {
                        LevelFilter::INFO
                    }
                    .into(),
                )
                .from_env()
                .unwrap(),
        )
        .init();

    let args = mattrax::setup();

    info!("Initializing Mattrax...");

    let listener = TcpListener::bind(args.listen_addr).await.map_err(|err| {
        error!(
            "Failed to bind to listen address {:?} with error: {err:?}",
            args.listen_addr
        )
    })?;

    let api = mx_api::Core::new(&args.database_url, args.secret.into_bytes())
        .map_err(|err| error!("Failed to initialise database: {err:?}"))?;

    api.migrate()
        .await
        .map_err(|err| error!("Failed to connect or run migrations on database: {err:?}"))?;

    tokio::spawn({
        let api = api.clone();

        async move {
            loop {
                api.cron().await;
                tokio::time::sleep(std::time::Duration::from_secs(300)).await;
            }
        }
    });

    let router = api.mount();

    // An endpoint to trigger cron tasks in development.
    #[cfg(debug_assertions)]
    let router = router.route(
        "/cron",
        axum::routing::get(|| async move {
            api.cron().await;
            (
                axum::http::StatusCode::OK,
                format!(
                    "Triggered at {:?}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .expect("time went backwards")
                        .as_millis()
                ),
            )
        }),
    );

    info!(
        "Listening at: http://{:?}",
        listener.local_addr().unwrap_or(args.listen_addr)
    );
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
        // I checked and I think this is actually unreachable.
        .expect("Error with Axum server");

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
