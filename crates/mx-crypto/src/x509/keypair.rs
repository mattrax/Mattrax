use rsa::{
    pkcs8::{DecodePrivateKey, EncodePrivateKey},
    RsaPrivateKey,
};

pub struct PrivateKey(pub(crate) RsaPrivateKey);

impl PrivateKey {
    pub fn generate_rsa(bits: usize) -> Result<Self, ()> {
        let mut rng = rand::thread_rng();
        Ok(Self(RsaPrivateKey::new(&mut rng, bits).unwrap()))
    }

    // TODO: Support other algorithms

    pub fn from_pkcs8_der(pkcs8: &[u8]) -> Result<Self, ()> {
        RsaPrivateKey::from_pkcs8_der(pkcs8)
            .map_err(|_| ())
            .map(Self)
    }

    pub fn encode_pkcs8_der(&self) -> Result<Vec<u8>, ()> {
        self.0
            .to_pkcs8_der()
            .map_err(|_| ())
            .map(|v| v.to_bytes().to_vec())
    }

    // pub fn from_pkcs8_pem(&self) -> Result<String, ()> {
    //     self.0
    //         .to_pkcs8_pem(LineEnding::LF)
    //         .map_err(|_| ())
    //         .map(|v| v.as_str().to_string())
    // }

    // pub fn to_pkcs8_pem(&self) -> Result<String, ()> {
    //     self.0
    //         .to_pkcs8_pem(LineEnding::LF)
    //         .map_err(|_| ())
    //         .map(|v| v.as_str().to_string())
    // }

    // TODO: Alternate formats???
}
