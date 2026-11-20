//! Embeds the release version.
//!
//! A tagged build passes `MATTRAXD_VERSION` so a nightly can identify itself
//! (for example `1.1.0-nightly.20261120`) while the crate keeps one version in
//! `Cargo.toml`. The updater compares the embedded version, so it must match
//! the manifest the release workflow publishes.
fn main() {
    println!("cargo:rerun-if-env-changed=MATTRAXD_VERSION");

    let version = std::env::var("MATTRAXD_VERSION")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| std::env::var("CARGO_PKG_VERSION").expect("CARGO_PKG_VERSION"));

    println!("cargo:rustc-env=MATTRAXD_VERSION={version}");
}
