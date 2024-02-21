use std::{future::Future, sync::Arc};

// TODO: Relax `Send` bound when moving off `rustls-acme`???

/// The backend storage for the ACME system.
///
/// This is used to store:
///  - The account
///  - The certificates
///  - The TLS-ALPN challenges
///
/// Be aware that the key and returned value should be treated as opaque.
pub trait Store: Send + Sync + 'static {
    fn get(
        &self,
        key: &str,
    ) -> impl Future<Output = Result<Option<Vec<u8>>, std::io::Error>> + Send;

    fn set(
        &self,
        key: &str,
        value: &[u8],
    ) -> impl Future<Output = Result<(), std::io::Error>> + Send;
}

impl<S: Store> Store for Arc<S> {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, std::io::Error> {
        self.as_ref().get(key).await
    }

    async fn set(&self, key: &str, value: &[u8]) -> Result<(), std::io::Error> {
        self.as_ref().set(key, value).await
    }
}
