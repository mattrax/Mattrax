use std::{
    borrow::Cow,
    future::Future,
    ops::Deref,
    sync::{PoisonError, RwLock},
};

/// Statically bundles a file's content into the binary for production builds while loading it from the FS during development.
/// Returns [`Static`]
macro_rules! include_static {
    ($file:expr $(,)?) => {{
        $crate::utils::Static::new_from_static(
            concat!(env!("CARGO_MANIFEST_DIR"), "/static/", $file),
            include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/static/", $file)),
        )
    }};
}

pub(crate) use include_static;

/// A static value included from the filesystem.
/// In production this will be embedded into the binary and in development it will be read from the filesystem.
#[derive(Clone, Copy)]
#[allow(unused)]
pub struct Static {
    path: &'static str,
    value: &'static str,
}

impl Static {
    // You should use `include_static!` instead!
    #[doc(hidden)]
    pub const fn new_from_static(path: &'static str, value: &'static str) -> Self {
        Self { path, value }
    }

    pub fn derive<T: Clone>(&self, map: impl Fn(&str) -> T + Clone) -> impl Fn() -> T + Clone {
        #[cfg(debug_assertions)]
        {
            let path = self.path;
            move || map(&std::fs::read_to_string(path).expect("failed to `include_static!`"))
        }

        #[cfg(not(debug_assertions))]
        {
            let value = map(self.value);
            move || value.clone()
        }
    }

    pub fn get(&self) -> Cow<'static, str> {
        #[cfg(debug_assertions)]
        {
            Cow::Owned(std::fs::read_to_string(self.path).expect("failed to `include_static!`"))
        }

        #[cfg(not(debug_assertions))]
        {
            Cow::Borrowed(self.value)
        }
    }
}

impl axum::response::IntoResponse for Static {
    fn into_response(self) -> axum::response::Response {
        self.get().into_response()
    }
}

// A primitive for building a cached value.
pub struct Cached<T> {
    value: RwLock<T>,
    updater: tokio::sync::RwLock<()>,
}

impl<T> Cached<T> {
    pub fn new(value: T) -> Self {
        Self {
            value: RwLock::new(value),
            updater: tokio::sync::RwLock::new(()),
        }
    }

    /// Attempts to apply an update to the value.
    /// This will bail out if an existing update is already in progress.
    ///
    /// This does *not* block reads while it is in progress.
    pub async fn update<E, F: Future<Output = Result<T, E>>>(
        &self,
        fetch: impl Fn() -> F,
    ) -> Result<(), E> {
        // We bail out if the lock is already held
        // We don't need to queue it, we know the value is being updated
        if let Ok(mut _guard) = self.updater.try_write() {
            *self.value.write().unwrap_or_else(PoisonError::into_inner) = fetch().await?;
        }
        Ok(())
    }

    /// Get the current value.
    pub fn get(&self) -> impl Deref<Target = T> + use<'_, T> {
        self.value.read().unwrap_or_else(PoisonError::into_inner)
    }
}

use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    ChaCha20Poly1305, Error,
};

/// Encrypts the data using symmetric encryption with the secret.
pub fn encrypt(secret: &[u8], data: &[u8]) -> Result<Vec<u8>, Error> {
    assert!(secret.len() > 32, "The secret must be bigger than 32 bytes");
    let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
    assert_eq!(nonce.len(), 12, "Expected nonce to be 12 bytes long"); // The decryption code relies on this.
    ChaCha20Poly1305::new_from_slice(&secret[32..])
        .expect("failed to create cipher from secret. We checked the length above.")
        .encrypt(&nonce, data)
        .map(|mut v| {
            let mut nonce = nonce.to_vec();
            nonce.append(&mut v);
            nonce
        })
}

/// Decrypt the data using symmetric encryption with the secret.
pub fn decrypt(secret: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, Error> {
    assert!(secret.len() > 32, "The secret must be bigger than 32 bytes");
    let (nonce, ciphertext) = ciphertext.split_at(12);
    ChaCha20Poly1305::new_from_slice(&secret[32..])
        .expect("failed to create cipher from secret. We checked the length above.")
        .decrypt(nonce.into(), ciphertext)
}
