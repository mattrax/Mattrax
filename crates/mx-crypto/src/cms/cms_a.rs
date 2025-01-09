use std::fmt;

use openssl::{
    pkcs7::{self, Pkcs7Flags},
    pkey::PKey,
    x509::X509,
};

use crate::x509::{Certificate, PrivateKey};

// #[derive(Debug, Clone)]
pub struct Pkcs7A {
    p7: pkcs7::Pkcs7,
}

impl fmt::Debug for Pkcs7A {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Pkcs7").finish()
    }
}

impl Pkcs7A {
    // TODO: `from_encrypted_der` instead and merge methods???

    pub fn from_der(der: &[u8]) -> Result<Self, ()> {
        // TODO: Don't alloc internally
        Ok(Self {
            p7: pkcs7::Pkcs7::from_der(der).unwrap(),
        })
    }

    // pub fn decrypt(&self, cert: &Certificate, key: &PrivateKey) -> Result<Vec<u8>, ()> {
    //     // We use `openssl` for pkcs7 decryption as `cryptographic_message_syntax` doesn't support it.
    //     let cert = X509::from_der(&cert.encode_der().unwrap()).unwrap();
    //     let key = PKey::private_key_from_pkcs8(&key.encode_pkcs8_der().unwrap()).unwrap();

    //     Ok(self
    //         .p7
    //         .decrypt(
    //             &key,
    //             &cert,
    //             // TODO: Configure these
    //             Pkcs7Flags::BINARY | Pkcs7Flags::NOCHAIN | Pkcs7Flags::NOINTERN,
    //         )
    //         .unwrap())
    // }

    pub fn decrypt(&self, cert: &Certificate, key: &PrivateKey) -> Result<Vec<u8>, ()> {
        // We use `openssl` for pkcs7 decryption as `cryptographic_message_syntax` doesn't support it.
        let cert = X509::from_der(&cert.encode_der().unwrap()).unwrap();
        let key = PKey::private_key_from_pkcs8(&key.encode_pkcs8_der().unwrap()).unwrap();

        Ok(self
            .p7
            .decrypt(
                &key,
                &cert,
                // TODO: Configure these
                Pkcs7Flags::BINARY | Pkcs7Flags::NOCHAIN | Pkcs7Flags::NOINTERN,
            )
            .unwrap())
    }

    // TODO: Decrypt signed + verify signature

    // TODO: Sign
    // TODO: Encrypt

    // TODO: Verify signer certificate chain
}
