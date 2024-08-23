use std::path::PathBuf;

use base64::{prelude::BASE64_STANDARD, Engine};
use rcgen::{
    BasicConstraints, CertificateParams, DnType, IsCa, KeyPair, KeyUsagePurpose,
    PKCS_ECDSA_P256_SHA256,
};

fn main() {
    // TODO: Add ability to renew certs (including updating the pool)
    // TODO: Pull/push to S3/AWS secret store

    println!("Generating certs...");
    let output_path = PathBuf::from("./certs");

    if output_path.exists() {
        println!("Certs already exist, exiting...");
        std::process::exit(0);
    }
    std::fs::create_dir_all(&output_path).unwrap();

    // TODO: Go through all params
    // TODO: This keypair is tiny compared to the old stuff, why is that????

    let mut params = CertificateParams::new(vec![]).unwrap();
    params
        .distinguished_name
        .push(DnType::OrganizationName, "Mattrax");
    params
        .distinguished_name
        .push(DnType::CommonName, "Mattrax Device Authority");
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained); // TODO: critical: true
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign]; // TODO: critical: true

    let key_pair = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap();
    let cert = params.self_signed(&key_pair).unwrap();

    std::fs::write(output_path.join("cert.der"), cert.der().to_vec()).unwrap();
    std::fs::write(output_path.join("cert.key"), key_pair.serialize_der()).unwrap();
    std::fs::write(output_path.join("pool.pem"), cert.pem()).unwrap();

    std::fs::write(
        output_path.join("env_IDENTITY_CERT"),
        BASE64_STANDARD.encode(cert.der().to_vec()),
    )
    .unwrap();
    std::fs::write(
        output_path.join("env_IDENTITY_KEY"),
        BASE64_STANDARD.encode(key_pair.serialize_der()),
    )
    .unwrap();

    std::fs::write(
        output_path.join("env_MANAGE_DOMAIN"),
        "EnterpriseEnrollment.example.com",
    )
    .unwrap();
    std::fs::write(
        output_path.join("env_ENROLLMENT_DOMAIN"),
        "manage.example.com",
    )
    .unwrap();

    println!("Generated certs...");
}
