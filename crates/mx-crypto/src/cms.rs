//! TODO: Find a better home for this.
//! Verifying PKCS7 (CMS) is a bit of a mess in Rust and that isn't helped by Apple's usage of a super old CA.
//!
//! The device-signed PKCS7 message is signed by an Apple CA that expired in 2017 so we need to override the not_after checking.
//! It also BER encoded and makes use of indefinite length which causes issues with many libraries that support DER as it forbids indefinite length encoding.
//!
//! Crates:
//!  - `cms` - Doesn't work due to: https://github.com/RustCrypto/formats/issues/779
//!  - `cryptographic_message_syntax` is able to parse the message but all of it's verification methods are broken.
//!
//! Due to this we use `cryptographic_message_syntax` to parse the PKCS7.
//! We then reparse the certificate with `x509_verify` to verify the integrity of the certificate chain. (Tracked as https://github.com/indygreg/cryptography-rs/issues/1)
//! We then convert the public key to `rsa` to verify the signature matches the signed content.
//!

mod cms_a;
mod cms_b;
mod scep;

pub use cms_a::Pkcs7A;
pub use cms_b::Pkcs7B;
pub use cryptographic_message_syntax::Oid;
pub use scep::scep_success;
