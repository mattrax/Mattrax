//! Release helper that writes the update manifest consumed by
//! `mattraxd update`.
//!
//! Run by `.github/workflows/release-agent.yml`:
//!
//! ```sh
//! MATTRAXD_UPDATE_SIGNING_KEY=<64 hex> \
//!   cargo run --release --bin mattraxd-manifest -- build \
//!   --version 1.1.0 --channel stable \
//!   --release-base-url https://github.com/…/releases/download/mattraxd-v1.1.0 \
//!   --artifact macos-aarch64=mattraxd-1.1.0-macos-universal \
//!   --artifact macos-x86_64=mattraxd-1.1.0-macos-universal \
//!   --artifact windows-x86_64=mattraxd-1.1.0-windows-x86_64.exe \
//!   --output mattraxd-manifest.json
//! ```
//!
//! Without `MATTRAXD_UPDATE_SIGNING_KEY` the manifest is written unsigned and
//! the helper exits successfully with a warning, so a fork can still produce
//! artifacts. An agent built with a public key refuses an unsigned manifest.

use clap::{Parser, Subcommand};
use mattraxd::update::manifest::{public_key_hex, signing_key_from_hex, Artifact, Manifest};
use mattraxd::update::Channel;
use mattraxd::util::{file_name, hex_lower};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(
    name = "mattraxd-manifest",
    version,
    about = "Build the mattraxd update manifest"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Write a manifest for the given artifacts.
    Build(BuildArgs),

    /// Print the public key for MATTRAXD_UPDATE_SIGNING_KEY.
    PublicKey,
}

#[derive(clap::Args)]
struct BuildArgs {
    /// Version the artifacts embed (must match `mattraxd version`).
    #[arg(long)]
    version: String,

    /// Channel this manifest is published as.
    #[arg(long, value_enum)]
    channel: Channel,

    /// Release asset base URL; artifact file names are appended.
    #[arg(long)]
    release_base_url: String,

    /// `platform=path`, repeatable. Supported platforms: macos-aarch64,
    /// macos-x86_64, windows-x86_64.
    #[arg(long = "artifact", value_name = "PLATFORM=PATH")]
    artifacts: Vec<String>,

    /// RFC 3339 timestamp; defaults to now.
    #[arg(long)]
    released_at: Option<String>,

    /// Write here instead of stdout.
    #[arg(long)]
    output: Option<PathBuf>,
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Command::PublicKey => match signing_key() {
            Some(key) => println!("{}", public_key_hex(&key.verifying_key())),
            None => fail("MATTRAXD_UPDATE_SIGNING_KEY is not set"),
        },
        Command::Build(arguments) => build(arguments),
    }
}

fn build(arguments: BuildArgs) {
    let mut artifacts = BTreeMap::new();

    for specification in &arguments.artifacts {
        let Some((platform, path)) = specification.split_once('=') else {
            fail(&format!(
                "--artifact must be PLATFORM=PATH, got {specification}"
            ));
        };

        if !matches!(
            platform,
            "macos-aarch64" | "macos-x86_64" | "windows-x86_64"
        ) {
            fail(&format!("unknown platform {platform}"));
        }

        if artifacts.contains_key(platform) {
            fail(&format!("platform {platform} was given twice"));
        }

        let path = Path::new(path);
        let sha256 = sha256(path).unwrap_or_else(|error| fail(&error));
        let size = std::fs::metadata(path)
            .map(|metadata| metadata.len())
            .unwrap_or_else(|error| fail(&error.to_string()));
        let url = format!(
            "{}/{}",
            arguments.release_base_url.trim_end_matches('/'),
            file_name(path)
        );

        artifacts.insert(
            platform.to_owned(),
            Artifact {
                url,
                sha256,
                size: Some(size),
            },
        );
    }

    if artifacts.is_empty() {
        fail("at least one --artifact is required");
    }

    let mut manifest = Manifest {
        schema: mattraxd::update::manifest::SCHEMA,
        channel: arguments.channel.as_str().to_owned(),
        version: arguments.version,
        released_at: arguments
            .released_at
            .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        signature: None,
        artifacts,
    };

    match signing_key() {
        Some(key) => manifest.sign(&key),
        None => eprintln!(
            "mattraxd-manifest: warning: MATTRAXD_UPDATE_SIGNING_KEY is not set; writing an unsigned manifest"
        ),
    }

    let json =
        serde_json::to_string_pretty(&manifest).unwrap_or_else(|error| fail(&error.to_string()));
    let json = format!("{json}\n");

    match arguments.output {
        Some(path) => {
            mattraxd::update::write_atomically(&path, json.as_bytes())
                .unwrap_or_else(|error| fail(&error.to_string()));
            eprintln!(
                "mattraxd-manifest: wrote {} ({})",
                path.display(),
                manifest.version
            );
        }
        None => print!("{json}"),
    }
}

/// GitHub Actions defines a missing secret as an empty env value; treat a blank
/// value as unset so a fork can still produce an unsigned manifest.
fn signing_key() -> Option<ed25519_dalek::SigningKey> {
    let seed = std::env::var("MATTRAXD_UPDATE_SIGNING_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())?;

    Some(signing_key_from_hex(&seed).unwrap_or_else(|error| fail(&error.to_string())))
}

fn sha256(path: &Path) -> Result<String, String> {
    let mut file =
        std::fs::File::open(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("{}: {error}", path.display()))?;

        if read == 0 {
            break;
        }

        hasher.update(&buffer[..read]);
    }

    Ok(hex_lower(&hasher.finalize()))
}

fn fail(message: &str) -> ! {
    eprintln!("mattraxd-manifest: {message}");
    std::process::exit(1);
}
