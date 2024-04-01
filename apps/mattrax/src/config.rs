use std::{
    fmt,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    ops::{Deref, DerefMut},
    path::PathBuf,
    sync::{Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcmeServer {
    #[default]
    Production,
    Staging,
}

impl AcmeServer {
    fn is_default(&self) -> bool {
        matches!(self, Self::Production)
    }

    pub fn into_better_acme_server(&self) -> better_acme::Server {
        match self {
            Self::Production => better_acme::Server::LetsEncrypt,
            Self::Staging => better_acme::Server::LetsEncryptStaging,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub domain: String,
    pub enrollment_domain: String,
    pub acme_email: String,
    #[serde(default, skip_serializing_if = "AcmeServer::is_default")]
    pub acme_server: AcmeServer,
    #[serde(with = "mx_utils::serde_with_hex")]
    pub secret: [u8; 32],
    pub db_url: String,
    pub internal_secret: String,
    pub cloud: Option<CloudConfig>,
    // pub setup_code: Option<String>,
    // #[serde(skip_serializing_if = "Option::is_none")]
    // pub conn_url: Option<String>,
}

/// Configuration properties for when deploying Mattrax at scale. (Eg. cloud.mattrax.app)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudConfig {
    // Domain for the frontend. Falls back to `Config::domain` if not set.
    pub frontend: Option<String>,
}

// impl Config {
//     pub(crate) fn db_conn_url(&self, data_dir: &PathBuf) -> String {
//         self.conn_url.clone().unwrap_or_else(|| {
//             data_dir
//                 .join("mattrax.db")
//                 .to_str()
//                 .expect("Found non-UTF8 path which is unsupported.")
//                 .to_string()
//         })
//     }
// }

pub struct ConfigManager {
    file: Mutex<File>,
    config: RwLock<Config>,
}

impl ConfigManager {
    pub fn from_path(path: PathBuf) -> Result<Self, ConfigError> {
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .truncate(false)
            .open(path)?;
        let size = file.metadata().map(|m| m.len() as usize).ok();

        let mut string = String::with_capacity(size.unwrap_or(0));
        file.read_to_string(&mut string)?;

        let config: Config = serde_json::from_str(&string)?;
        Ok(Self {
            file: Mutex::new(file),
            config: RwLock::new(config),
        })
    }

    pub fn lock(&self) -> MutableConfig<'_> {
        MutableConfig {
            config: self.config.write().unwrap_or_else(PoisonError::into_inner),
            guard: self.file.lock().unwrap_or_else(PoisonError::into_inner),
        }
    }

    pub fn get(&self) -> RwLockReadGuard<'_, Config> {
        self.config.read().unwrap_or_else(PoisonError::into_inner)
    }
}

impl fmt::Debug for ConfigManager {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.config
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .fmt(f)
    }
}

/// A mutually exclusive reference to a `Config`.
/// This means no one else can touch it while you hold this type.
/// *WARNING* This type does not save on `Drop` as stable Rust doesn't have `TryDrop` and tbh I don't even think it should.
pub struct MutableConfig<'a> {
    config: RwLockWriteGuard<'a, Config>,
    guard: MutexGuard<'a, File>,
}

impl<'a> MutableConfig<'a> {
    pub fn save(mut self) -> Result<(), ConfigError> {
        let config = serde_json::to_string_pretty(&*self.config)?;
        self.guard.seek(SeekFrom::Start(0))?;
        self.guard.set_len(0)?;
        self.guard.write_all(config.as_bytes())?;
        Ok(())
    }
}

impl<'a> Deref for MutableConfig<'a> {
    type Target = Config;

    fn deref(&self) -> &Self::Target {
        &self.config
    }
}

impl<'a> DerefMut for MutableConfig<'a> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.config
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("IoError({0})")]
    IoError(#[from] std::io::Error),
    #[error("JsonError({0})")]
    JsonError(#[from] serde_json::Error),
}
