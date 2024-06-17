use ms_mde::MICROSOFT_DEVICE_ID_EXTENSION;
use rustls::pki_types::CertificateDer;
use tracing::{debug, info};
use x509_parser::{
    certificate::X509Certificate,
    der_parser::{asn1_rs::FromDer, Oid},
};

pub(crate) fn handler(
    root_cert: &X509Certificate<'static>,
    client_cert: Option<CertificateDer<'_>>,
) -> Option<(Option<String>, String)> {
    let Some(cert) = client_cert else {
        debug!("No client certificate provided");
        return None;
    };

    let (_, cert) = X509Certificate::from_der(&cert).unwrap(); // TODO: Error handling

    let Ok(_) = cert.verify_signature(Some(root_cert.public_key())) else {
        debug!("Client certificate was not signed by Mattrax!");
        return None;
    };

    // TODO: Error handling
    let device_id = String::from_utf8(
        cert.extensions_map()
            .unwrap()
            .get(&Oid::from(MICROSOFT_DEVICE_ID_EXTENSION).unwrap())
            .unwrap()
            .value
            .to_vec(),
    )
    .unwrap();

    let common_name = cert
        .subject()
        .iter_common_name()
        .next()
        .unwrap()
        .attr_value()
        .as_string()
        .unwrap(); // TODO: Error handling

    if !cert.validity().is_valid() {
        info!("Client certificate for device '{}' has expired", device_id);
    }

    // TODO: Account for the AzureAD user (`Authorization` header) in this
    let upn = if common_name == device_id {
        None
    } else {
        Some(common_name)
    };

    Some((upn, device_id))
}
