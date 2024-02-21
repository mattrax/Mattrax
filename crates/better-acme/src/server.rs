/// TODO
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Server {
    /// TODO
    LetsEncryptStaging,
    /// TODO
    LetsEncrypt,
}

impl Server {
    /// TODO
    pub fn directory_url(&self) -> &'static str {
        match self {
            Server::LetsEncryptStaging => "https://acme-staging-v02.api.letsencrypt.org/directory",
            Server::LetsEncrypt => "https://acme-v02.api.letsencrypt.org/directory",
        }
    }
}
