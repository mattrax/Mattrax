use include_dir::{include_dir, Dir};
use std::io::Write;
use temp_dir::TempDir;
use tracing::debug;

const WEB_ASSETS: Dir = include_dir!("$CARGO_MANIFEST_DIR/../web/.output");

fn extract_assets() -> TempDir {
    let temp_dir = TempDir::new().expect("Failed to make temp dir for web assets!");

    debug!("Extracting web assets to {}", temp_dir.path().display());

    WEB_ASSETS
        .extract(temp_dir.path())
        .expect("Failed to extract web assets");

    temp_dir
}

pub fn spawn_process(internal_secret: &str) {
    let internal_secret = internal_secret.to_string();

    std::thread::spawn(move || {
        let web_assets_dir = extract_assets();

        let web_server_port = 12345;

        std::process::Command::new("node")
            .env("PORT", web_server_port.to_string())
            .env(
                "DATABASE_URL",
                format!("http://:{internal_secret}@localhost:9000"),
            )
            .envs(std::env::vars())
            .args([web_assets_dir.path().join("server/index.mjs")])
            .stdout(std::io::stdout())
            .stderr(std::io::stderr())
            .output()
            .expect("Failed to run web server");
    });
}
