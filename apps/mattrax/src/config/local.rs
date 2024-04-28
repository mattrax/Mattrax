use std::{
    fs::File,
    io::{self, ErrorKind, Read, Write},
    path::Path,
};

use serde::{Deserialize, Serialize};

/// This configuration is store in a JSON file on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConfig {
    pub node_id: String,
    pub db_url: String,
}

impl LocalConfig {
    pub fn load(path: impl AsRef<Path>) -> io::Result<Self> {
        let path = path.as_ref();
        let mut file = File::open(path).map_err(|err| {
            io::Error::new(err.kind(), format!("Failed to open file '{path:?}': {err}"))
        })?;
        let mut string = String::new();
        file.read_to_string(&mut string).map_err(|err| {
            io::Error::new(err.kind(), format!("Failed to read file '{path:?}': {err}"))
        })?;
        Ok(serde_json::from_str(&string).map_err(|err| {
            io::Error::new(
                ErrorKind::Other,
                format!("Failed to deserialize 'LocalConfig' from file '{path:?}': {err}"),
            )
        })?)
    }

    pub fn save(&self, path: impl AsRef<Path>) -> io::Result<()> {
        let path = path.as_ref();
        let string = serde_json::to_string_pretty(self).map_err(|err| {
            io::Error::new(
                ErrorKind::Other,
                format!("Failed to serialize 'LocalConfig'': {err}"),
            )
        })?;
        let mut file = File::create(path).map_err(|err| {
            io::Error::new(
                err.kind(),
                format!("Failed to create/open file '{path:?}': {err}"),
            )
        })?;
        file.write_all(string.as_bytes()).map_err(|err| {
            io::Error::new(
                err.kind(),
                format!("Failed to write to file '{path:?}': {err}"),
            )
        })?;
        Ok(())
    }
}
