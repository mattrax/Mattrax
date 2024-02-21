use std::{io, path::PathBuf};

use sha2::{Digest, Sha256};
use tokio::task::spawn_blocking;

use crate::Store;

/// A wrapper [Store] that caches the values on the filesystem.
pub struct FsStore<S: Store> {
    dir: PathBuf,
    store: S,
    // TODO: LRU caching
}

impl<S: Store> FsStore<S> {
    pub fn new(dir: PathBuf, store: S) -> Result<Self, io::Error> {
        if !dir.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "The provided path is not a directory",
            ));
        }
        std::fs::create_dir_all(&dir)?;

        Ok(Self { dir, store: store })
    }
}

// TODO: Dependency inject `spawn_blocking` so we can easily work with non-Tokio runtime's

impl<S: Store> Store for FsStore<S> {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, std::io::Error> {
        let path = self.dir.join({
            let mut hasher = Sha256::new();
            hasher.update(key.as_bytes());
            let result = hasher.finalize();
            String::from_utf8_lossy(&base91::slice_encode(result.as_slice())).to_string()
        });

        let result = match spawn_blocking({
            let path = path.clone();
            move || std::fs::read(path)
        })
        .await?
        {
            Ok(data) => Some(data),
            Err(err) if err.kind() == io::ErrorKind::NotFound => None,
            Err(err) => return Err(err),
        };

        match result {
            Some(data) => Ok(Some(data)),
            None => {
                let result = self.store.get(key).await?;

                if let Some(value) = &result {
                    let value = value.clone();

                    spawn_blocking(move || {
                        std::fs::write(&path, value).map_err(|err| {
                            println!("Error writing to path '{path:?}': {:?}", err);
                            err
                        })
                    })
                    .await
                    // We ignore the result as it failing to cache to the FS is not a critical error.
                    .ok();
                };

                Ok(result)
            }
        }
    }

    async fn set(&self, key: &str, value: &[u8]) -> Result<(), std::io::Error> {
        let path = self.dir.join({
            let mut hasher = Sha256::new();
            hasher.update(key.as_bytes());
            let result = hasher.finalize();
            String::from_utf8_lossy(&base91::slice_encode(result.as_slice())).to_string()
        });

        self.store.set(key, value).await?;

        spawn_blocking({
            let value = value.to_vec();
            move || {
                std::fs::write(&path, value).map_err(|err| {
                    println!("Error writing to path '{path:?}': {:?}", err);
                    err
                })
            }
        })
        .await
        // We ignore the result as it failing to cache to the FS is not a critical error.
        .ok();

        Ok(())
    }
}
