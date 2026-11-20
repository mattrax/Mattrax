//! Self-update over a signed release manifest.
//!
//! `mattraxd update` fetches a channel manifest (`stable` or `latest`),
//! verifies the manifest signature (when the binary was built with a public
//! key), downloads the artifact for this platform, verifies its SHA-256 and
//! atomically replaces the running binary. Verification is fail-closed: a
//! missing or malformed signature, a checksum mismatch, an insecure URL or a
//! downgrade aborts before the installed binary is touched.

pub mod manifest;

use crate::logging::Logger;
use crate::util::hex_lower;
use clap::ValueEnum;
use manifest::{Artifact, Manifest, UpdateError};
use semver::Version;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::process::Command;

/// Rolling GitHub release that only carries channel pointers:
/// `stable.json`, `latest.json` and `nightly.json`.
pub const DEFAULT_BASE_URL: &str =
    "https://github.com/mattrax/Mattrax/releases/download/agent-channels";

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Channel {
    /// Newest non-prerelease tag.
    Stable,
    /// Newest published build, including prereleases and nightly builds.
    Latest,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Latest => "latest",
        }
    }

    pub fn manifest_file(self) -> &'static str {
        match self {
            Self::Stable => "stable.json",
            Self::Latest => "latest.json",
        }
    }
}

#[derive(Debug, Clone)]
pub struct UpdateOptions {
    pub channel: Channel,
    pub check: bool,
    pub restart: bool,
    pub force: bool,
    /// Overrides the channel URL; used by self-hosted deployments and tests.
    pub manifest_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    UpToDate {
        version: String,
    },
    Available {
        version: String,
        platform: String,
        url: String,
    },
    Updated {
        from: String,
        to: String,
        restarted: bool,
    },
}

/// A build for one platform is newer/older/different.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plan {
    UpToDate,
    Install,
}

pub fn manifest_url(base: &str, channel: Channel) -> String {
    format!("{}/{}", base.trim_end_matches('/'), channel.manifest_file())
}

pub fn platform_key() -> Result<&'static str, UpdateError> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Ok("macos-aarch64")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Ok("macos-x86_64")
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Ok("windows-x86_64")
    } else {
        Err(UpdateError::Platform(format!(
            "no mattraxd artifact for {}-{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        )))
    }
}

/// Refuse to downgrade unless forced. A same-version manifest is a no-op.
pub fn plan(current: &Version, remote: &Version, force: bool) -> Result<Plan, UpdateError> {
    if remote == current {
        return Ok(Plan::UpToDate);
    }

    if remote < current && !force {
        return Err(UpdateError::Downgrade {
            current: current.to_string(),
            remote: remote.to_string(),
        });
    }

    Ok(Plan::Install)
}

pub fn select_artifact<'a>(
    manifest: &'a Manifest,
    platform: &str,
) -> Result<&'a Artifact, UpdateError> {
    manifest.artifacts.get(platform).ok_or_else(|| {
        UpdateError::Platform(format!(
            "manifest has no artifact for {platform} (available: {})",
            manifest
                .artifacts
                .keys()
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ))
    })
}

pub fn sha256_file(path: &Path) -> Result<String, UpdateError> {
    let mut file = File::open(path).map_err(|error| UpdateError::Io(error.to_string()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| UpdateError::Io(error.to_string()))?;

        if read == 0 {
            break;
        }

        hasher.update(&buffer[..read]);
    }

    Ok(hex_lower(&hasher.finalize()))
}

pub fn verify_artifact(path: &Path, artifact: &Artifact) -> Result<(), UpdateError> {
    let actual = sha256_file(path)?;

    if actual != artifact.sha256.to_lowercase() {
        return Err(UpdateError::Checksum {
            expected: artifact.sha256.clone(),
            actual,
        });
    }

    Ok(())
}

/// Update this binary. `current_exe` is injectable so tests never touch a real
/// installation.
pub fn run(
    options: &UpdateOptions,
    logger: &Logger,
    current_exe: &Path,
) -> Result<Outcome, UpdateError> {
    let current = Version::parse(crate::VERSION).map_err(|error| {
        UpdateError::Manifest(format!("this binary has an invalid version: {error}"))
    })?;
    let channel = options.channel;
    let url = options.manifest_url.clone().unwrap_or_else(|| {
        let base = std::env::var("MATTRAX_UPDATE_BASE_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_owned());

        manifest_url(&base, channel)
    });

    logger.log(format!("update: checking {} ({url})", channel.as_str()));

    let body = fetch(&url).map_err(|error| UpdateError::Http(format!("{url}: {error}")))?;
    let text = String::from_utf8(body)
        .map_err(|_| UpdateError::Manifest("manifest is not valid UTF-8".into()))?;
    let manifest: Manifest = serde_json::from_str(&text)
        .map_err(|error| UpdateError::Manifest(format!("manifest is not valid JSON: {error}")))?;

    let public_key = configured_public_key()?;

    if public_key.is_none() {
        logger.log(
      "update: no manifest public key configured; verifying checksums only (signature verification disabled)",
    );
    }

    manifest.validate(allow_insecure_urls())?;
    manifest.verify_signature(public_key.as_ref())?;

    if manifest.channel != channel.as_str() {
        return Err(UpdateError::Manifest(format!(
            "expected a {} manifest, got {}",
            channel.as_str(),
            manifest.channel
        )));
    }

    let remote = Version::parse(&manifest.version).map_err(|error| {
        UpdateError::Manifest(format!(
            "manifest version {} is invalid: {error}",
            manifest.version
        ))
    })?;

    let platform = platform_key()?;
    let artifact = select_artifact(&manifest, platform)?;

    match plan(&current, &remote, options.force)? {
        Plan::UpToDate => {
            return Ok(Outcome::UpToDate {
                version: current.to_string(),
            })
        }
        Plan::Install => {}
    }

    if options.check {
        return Ok(Outcome::Available {
            version: remote.to_string(),
            platform: platform.to_owned(),
            url: artifact.url.clone(),
        });
    }

    let directory = current_exe
        .parent()
        .ok_or_else(|| UpdateError::Io("the running binary has no parent directory".into()))?;
    let temporary = directory.join(format!(
        ".{}.update-{}",
        crate::util::file_name(current_exe),
        std::process::id()
    ));

    logger.log(format!(
        "update: downloading {} {} ({})",
        remote, platform, artifact.url
    ));

    let result = (|| {
        download(&artifact.url, &temporary)?;
        verify_artifact(&temporary, artifact)?;
        install(&temporary, current_exe)?;
        Ok::<(), UpdateError>(())
    })();

    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }

    let restarted = if options.restart {
        restart_service()?;
        true
    } else {
        false
    };

    logger.log(format!("update: replaced {current} with {remote}"));

    Ok(Outcome::Updated {
        from: current.to_string(),
        to: remote.to_string(),
        restarted,
    })
}

fn configured_public_key() -> Result<Option<ed25519_dalek::VerifyingKey>, UpdateError> {
    let value = std::env::var("MATTRAX_UPDATE_PUBLIC_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            option_env!("MATTRAXD_UPDATE_PUBLIC_KEY")
                .map(str::to_owned)
                .filter(|value| !value.trim().is_empty())
        });

    value
        .map(|value| manifest::public_key_from_hex(&value))
        .transpose()
}

/// Never let a redirect downgrade an HTTPS download to plain HTTP unless the
/// operator explicitly opted into an insecure mirror.
fn allowed_protocols() -> &'static str {
    if allow_insecure_urls() {
        "=http,https"
    } else {
        "=https"
    }
}

fn allow_insecure_urls() -> bool {
    std::env::var("MATTRAX_UPDATE_ALLOW_INSECURE")
        .map(|value| value == "1")
        .unwrap_or(false)
}

fn install(staged: &Path, target: &Path) -> Result<(), UpdateError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(staged, fs::Permissions::from_mode(0o755))
            .map_err(|error| UpdateError::Io(error.to_string()))?;
    }

    // Flush before the rename so a power loss cannot leave an empty binary.
    File::open(staged)
        .and_then(|file| file.sync_all())
        .map_err(|error| UpdateError::Io(error.to_string()))?;

    #[cfg(windows)]
    {
        // Windows cannot rename over a running executable. Keep the old binary as
        // a rollback until the new one is in place.
        let backup = target.with_extension("old");
        let _ = fs::remove_file(&backup);
        fs::rename(target, &backup).map_err(|error| UpdateError::Io(error.to_string()))?;

        if let Err(error) = fs::rename(staged, target) {
            let _ = fs::rename(&backup, target);
            return Err(UpdateError::Io(error.to_string()));
        }

        let _ = fs::remove_file(backup);
    }

    #[cfg(not(windows))]
    {
        fs::rename(staged, target).map_err(|error| UpdateError::Io(error.to_string()))?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub fn restart_service() -> Result<(), UpdateError> {
    let output = Command::new("/bin/launchctl")
        .args([
            "kickstart",
            "-k",
            &format!("system/{}", crate::LAUNCHD_LABEL),
        ])
        .output()
        .map_err(|error| UpdateError::Restart(error.to_string()))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(UpdateError::Restart(format!(
            "launchctl kickstart failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
}

#[cfg(target_os = "windows")]
pub fn restart_service() -> Result<(), UpdateError> {
    // The Windows service registration is not part of this release; a service
    // named mattraxd is the documented target.
    let _ = Command::new("sc.exe").args(["stop", "mattraxd"]).output();
    let output = Command::new("sc.exe")
        .args(["start", "mattraxd"])
        .output()
        .map_err(|error| UpdateError::Restart(error.to_string()))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(UpdateError::Restart(format!(
            "sc.exe start mattraxd failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn restart_service() -> Result<(), UpdateError> {
    Err(UpdateError::Restart(
        "restarting the agent is not supported on this platform".into(),
    ))
}

fn fetch(url: &str) -> Result<Vec<u8>, String> {
    let output = Command::new(curl())
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--max-redirs",
            "5",
            "--max-filesize",
            "1048576",
            "--proto",
            allowed_protocols(),
            "--proto-redir",
            allowed_protocols(),
            "--max-time",
            "60",
            url,
        ])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }

    Ok(output.stdout)
}

fn download(url: &str, path: &Path) -> Result<(), UpdateError> {
    let output = Command::new(curl())
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--max-redirs",
            "5",
            "--max-filesize",
            "104857600",
            "--proto",
            allowed_protocols(),
            "--proto-redir",
            allowed_protocols(),
            "--max-time",
            "600",
            "--output",
        ])
        .arg(path)
        .arg(url)
        .output()
        .map_err(|error| UpdateError::Http(error.to_string()))?;

    if !output.status.success() {
        return Err(UpdateError::Http(format!(
            "{url}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn curl() -> &'static str {
    "/usr/bin/curl"
}

#[cfg(not(target_os = "macos"))]
fn curl() -> &'static str {
    "curl"
}

/// Write bytes to a path via a sibling temp file. Exposed for the update
/// manifest tool.
pub fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), UpdateError> {
    let temporary = path.with_extension(format!("tmp.{}", std::process::id()));

    File::create(&temporary)
        .and_then(|mut file| file.write_all(bytes))
        .map_err(|error| UpdateError::Io(error.to_string()))?;

    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|error| UpdateError::Io(error.to_string()))?;
    }

    fs::rename(&temporary, path).map_err(|error| UpdateError::Io(error.to_string()))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn artifact() -> Artifact {
        Artifact {
            url: "https://example.test/mattraxd".into(),
            sha256: "a".repeat(64),
            size: Some(10),
        }
    }

    fn manifest(version: &str) -> Manifest {
        Manifest {
            schema: 1,
            channel: "stable".into(),
            version: version.into(),
            released_at: "2026-11-20T00:00:00Z".into(),
            signature: None,
            artifacts: BTreeMap::from([("macos-aarch64".into(), artifact())]),
        }
    }

    #[test]
    fn plan_refuses_downgrades_unless_forced() {
        let current = Version::parse("1.2.0").unwrap();

        assert_eq!(
            plan(&current, &Version::parse("1.2.0").unwrap(), false),
            Ok(Plan::UpToDate)
        );
        assert_eq!(
            plan(&current, &Version::parse("1.3.0").unwrap(), false),
            Ok(Plan::Install)
        );
        assert!(matches!(
            plan(&current, &Version::parse("1.1.0").unwrap(), false),
            Err(UpdateError::Downgrade { .. })
        ));
        assert_eq!(
            plan(&current, &Version::parse("1.1.0").unwrap(), true),
            Ok(Plan::Install)
        );
    }

    #[test]
    fn manifest_urls_are_per_channel() {
        assert_eq!(
            manifest_url("https://example.test/channels/", Channel::Stable),
            "https://example.test/channels/stable.json"
        );
        assert_eq!(
            manifest_url("https://example.test/channels", Channel::Latest),
            "https://example.test/channels/latest.json"
        );
    }

    #[test]
    fn selects_the_platform_artifact_and_reports_missing_ones() {
        let manifest = manifest("1.2.0");
        let selected = select_artifact(&manifest, "macos-aarch64").expect("artifact");

        assert_eq!(selected.sha256, "a".repeat(64));
        assert!(select_artifact(&manifest, "windows-x86_64").is_err());
    }

    #[test]
    fn verifies_a_downloaded_artifact() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("artifact");
        fs::write(&path, b"hello").unwrap();

        let mut artifact = artifact();
        artifact.sha256 = sha256_file(&path).unwrap();
        assert!(verify_artifact(&path, &artifact).is_ok());

        artifact.sha256 = "b".repeat(64);
        assert!(matches!(
            verify_artifact(&path, &artifact),
            Err(UpdateError::Checksum { .. })
        ));
    }

    #[test]
    fn writes_atomically() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("manifest.json");

        write_atomically(&path, b"one").unwrap();
        write_atomically(&path, b"two").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"two");
    }
}
