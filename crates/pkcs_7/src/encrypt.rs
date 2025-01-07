use aes::{
    cipher::{Array, BlockModeEncrypt, IvSizeUser, KeyIvInit, KeySizeUser},
    Aes128,
};
use bcder::{Captured, OctetString, Oid};
use bytes::Bytes;
use cbc::cipher::block_padding::Pkcs7;
// use cryptographic_message_syntax::asn1::rfc5652::{self, OID_ENCRYPTED_DATA, OID_ID_DATA};
use des::{cipher::BlockSizeUser, Des};
use rand::RngCore;
use rasn::{
    der::encode,
    types::{Any, Integer, ObjectIdentifier},
};
use rasn_cms::{AlgorithmIdentifier, ContentInfo};
use x509_certificate::rfc5280::AlgorithmParameter;

/// Encrypt creates and returns an envelope data PKCS7 structure with encrypted
/// recipient keys for each recipient public key.
///
/// The algorithm used to perform encryption is determined by the current value
/// of the global ContentEncryptionAlgorithm package variable. By default, the
/// value is EncryptionAlgorithmDESCBC. To use a different algorithm, change the
/// value before calling Encrypt(). For example:
///
///	ContentEncryptionAlgorithm = EncryptionAlgorithmAES256GCM
///
// TODO: Add support for encrypting content with other algorithms
// TODO: `IntoIterator` instead of `Vec` to avoid alloc
pub fn encrypt(content: &[u8], recipients: Vec<()>) -> Result<Vec<u8>, ()> {
    // TODO: Match on algorithm
    let (key, eci) = encrypt_des_cbc(content, None)?;

    //    // Prepare each recipient's encrypted cipher key
    // recipientInfos := make([]recipientInfo, len(recipients))
    // for i, recipient := range recipients {
    // 	algorithm := KeyEncryptionAlgorithm
    // 	hash := KeyEncryptionHash
    // 	var kea pkix.AlgorithmIdentifier
    // 	switch {
    // 	case algorithm.Equal(OIDEncryptionAlgorithmRSAESOAEP):
    // 		parameters, err := getParametersForKeyEncryptionAlgorithm(algorithm, hash)
    // 		if err != nil {
    // 			return nil, fmt.Errorf("failed to get parameters for key encryption: %v", err)
    // 		}
    // 		kea = pkix.AlgorithmIdentifier{
    // 			Algorithm:  algorithm,
    // 			Parameters: parameters,
    // 		}
    // 	case algorithm.Equal(OIDEncryptionAlgorithmRSA):
    // 		kea = pkix.AlgorithmIdentifier{
    // 			Algorithm: algorithm,
    // 		}
    // 	default:
    // 		return nil, ErrUnsupportedKeyEncryptionAlgorithm
    // 	}
    // 	encrypted, err := encryptKey(key, recipient, algorithm, hash)
    // 	if err != nil {
    // 		return nil, err
    // 	}
    // 	ias, err := cert2issuerAndSerial(recipient)
    // 	if err != nil {
    // 		return nil, err
    // 	}
    // 	info := recipientInfo{
    // 		Version:                0,
    // 		IssuerAndSerialNumber:  ias,
    // 		KeyEncryptionAlgorithm: kea,
    // 		EncryptedKey:           encrypted,
    // 	}
    // 	recipientInfos[i] = info
    // }

    // Prepare envelope content
    let envelope = rasn_cms::EnvelopedData {
        version: Integer::from(0),
        recipient_infos: todo!(),
        encrypted_content_info: eci,
        originator_info: None,
        unprotected_attrs: None,
    };
    let inner_content = rasn::der::encode(&envelope).unwrap();

    // Prepare outer payload structure
    let wrapper = ContentInfo {
        content_type: ObjectIdentifier::new(&[1, 2, 840, 113549, 1, 7, 3]).unwrap(),
        // TODO:  asn1.RawValue{Class: 2, Tag: 0, IsCompound: true, Bytes: innerContent},
        content: todo!(),
    };

    Ok(rasn::der::encode(&wrapper).unwrap())
}

// TODO: Maybe generic on algo???
fn encrypt_des_cbc(
    content: &[u8],
    key: Option<Vec<u8>>,
) -> Result<(Vec<u8>, rasn_cms::EncryptedContentInfo), ()> {
    let key = key.unwrap_or_else(|| {
        // Create DES key
        let mut key = vec![0; 16]; // TODO: Des::key_size()]; // TODO: 8];
        rand::thread_rng().fill_bytes(&mut key);
        key
    });

    // Create CBC IV
    let mut iv = vec![0; 16]; // TODO: cbc::Encryptor::<aes::Aes128>::iv_size()];
    rand::thread_rng().fill_bytes(&mut iv);

    let mut content = content.to_vec();
    let content_len = content.len();
    content.resize(content_len + 100, 0); // TODO: Work this out properly

    let cyphertext = cbc::Encryptor::<aes::Aes128>::new(
        &Array::try_from(key.as_slice()).unwrap(),
        &Array::try_from(iv.as_slice()).unwrap(),
    )
    .encrypt_padded::<Pkcs7>(&mut content, content_len)
    .unwrap()
    .to_vec();

    // Prepare ASN.1 Encrypted Content Info
    let eci = rasn_cms::EncryptedContentInfo {
        content_type: ObjectIdentifier::new(&[1, 2, 840, 113549, 1, 7, 1]).unwrap(), // TODO: Constant
        content_encryption_algorithm: AlgorithmIdentifier {
            // TODO: As constant: OIDEncryptionAlgorithmDESCBC     = asn1.ObjectIdentifier{1, 3, 14, 3, 2, 7}
            algorithm: ObjectIdentifier::new(&[1, 3, 14, 3, 2, 7]).unwrap(),
            parameters: Some(Any::new(OctetString::new(iv.into()).to_bytes().to_vec())),
        },
        // TODO: Does this match `marshalEncryptedContent` in Go?
        encrypted_content: Some(cyphertext.into()),
    };

    Ok((key, eci))
}
