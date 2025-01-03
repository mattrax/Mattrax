use mx_apple::parse_pkcs7;
use spki::der::Decode;

fn main() {
    let file = std::fs::read("./apple-connect").unwrap();

    // TODO: https://github.com/RustCrypto/formats/issues/779
    let a = cms::signed_data::SignedData::from_der(&file).unwrap();

    // let d = cryptographic_message_syntax::SignedData::parse_ber(&file).unwrap();
    // verify_pkcs7(d, &mx_apple::APPLE_IPHONE_DEVICE_CA);
}
