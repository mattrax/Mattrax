use std::sync::Arc;

use chrono::Duration;
use sqlx::{query, query_as};
use tracing::info;
use x509_certificate::{certificate::KeyUsage, rfc3280::Name};

use crate::{utils::Cached, Core};

#[derive(Clone, Debug)]
struct IdentityRow {
    id: u64,
    cert: Vec<u8>,
    key: zeroize::Zeroizing<Vec<u8>>,
    not_after: chrono::DateTime<chrono::Utc>,
    not_before: chrono::DateTime<chrono::Utc>,
}

/// Manager for the device CA.
#[derive(Clone)]
pub struct DeviceCA(Arc<Cached<Vec<IdentityRow>>>);

impl DeviceCA {
    pub fn new() -> Self {
        Self(Arc::new(Cached::new(Default::default())))
    }

    pub async fn verify(&self) {
        // let todo = loop {
        //     let (version, identities) = self.value.read().unwrap();

        //     if identities.len() == 0 {
        //         break true;
        //     }
        // };

        // println!("GOT {:?}", self.value.get());

        todo!();
    }

    pub fn active_signer(&self) {
        let value = self.0.get();
        if value.is_empty() {
            // Self::refresh(core);
            todo!();
        }

        //     println!("GOT {:?}", self.value.get());
        //     // todo!();
    }

    /// Setup a task to keep the device CA updated in the background.
    pub fn updater_task(core: Core) {
        tokio::spawn(async move {
            loop {
                Self::refresh(&core).await;
                tokio::time::sleep(std::time::Duration::from_secs(5 * 60)).await;
            }
        });
    }

    /// Refresh the device CA cache.
    pub async fn refresh(core: &Core) {
        core.device_ca
            .0
            .update(|| async move {
                let active_identities = query_as!(
                    IdentityRow,
                    "SELECT id, cert, `key`, not_after, not_before FROM identity WHERE CURRENT_TIMESTAMP() BETWEEN not_before AND not_after"
                )
                .fetch_all(&core.db)
                .await?;

                // let cert =
                //     x509_certificate::X509Certificate::from_der(&std::fs::read("./cert.der").unwrap()).unwrap();
                // let keypair = x509_certificate::InMemorySigningKeyPair::from_pkcs8_der(
                //     &std::fs::read("./key.der").unwrap(),
                // )
                // .unwrap();

                info!("successfully refreshed the device CA cache");
                Ok::<_, sqlx::Error>(active_identities)
            })
            .await
            .unwrap(); // TODO
    }
}

pub async fn refresh_device_ca(core: &Core) -> sqlx::Result<()> {
    let active_identities = query!(
        "SELECT id, not_after FROM identity WHERE CURRENT_TIMESTAMP() BETWEEN not_before AND not_after"
    )
    .fetch_all(&core.db)
    .await?;

    let must_refresh = active_identities.len() == 0
        || active_identities.iter().any(|identity| {
            let remaining = identity.not_after.signed_duration_since(chrono::Utc::now());
            println!("A {:?}", remaining.num_seconds());
            remaining.num_seconds() < 60 * 60 * 24 * 7 // TODO: Configure this for dev
        });

    if must_refresh {
        info!("Detected that the device CA needs to be refreshed...");
        let (cert, key, not_before, not_after) = issue_device_ca().unwrap();

        // Using the database we set the primary key of the table to the closest 5 minute interval in epoch.
        // We also configure the query to not update the row if it already exists.
        // This means if multiple clients attempt to refresh the device CA at once, only one of them will succeed.
        // It's undefined which one so we can't use the result of `issue_root` without going back to the database.
        // This system very intentionally relys on the database time to avoid any client side time drift causing issues.
        query!(
            "INSERT INTO identity(id, cert, `key`, not_before, not_after) VALUES (UNIX_TIMESTAMP() - (UNIX_TIMESTAMP() % 300), ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id=id",
            cert,
            key.to_vec(),
            not_before,
            not_after
        )
        .execute(&core.db)
        .await
        .unwrap();
    }

    DeviceCA::refresh(&core).await;

    Ok(())
}

/// The amount of the time the device CA is valid for.
static DEVICE_CA_VALIDITY: Duration = if cfg!(debug_assertions) {
    // We significantly reduce the validity in debug mode so we can spot bugs easier.
    Duration::days(1)
} else {
    Duration::days(365)
};

fn issue_device_ca() -> Result<
    (
        Vec<u8>,
        zeroize::Zeroizing<Vec<u8>>,
        chrono::DateTime<chrono::Utc>,
        chrono::DateTime<chrono::Utc>,
    ),
    x509_certificate::X509CertificateError,
> {
    let name = {
        let mut name = Name::default();
        name.append_common_name_utf8_string("Mattrax Device CA")
            .expect("Hardcoded common name string is valid UTF-8");
        name
    };

    let mut cert = x509_certificate::X509CertificateBuilder::default();
    *cert.subject() = name.clone();
    *cert.issuer() = name;
    cert.validity_duration(DEVICE_CA_VALIDITY);
    cert.key_usage(KeyUsage::KeyCertSign);

    let (cert, keypair) =
        cert.create_with_random_keypair(x509_certificate::KeyAlgorithm::Ed25519)?;

    Ok((
        cert.encode_der().unwrap(),
        keypair.to_pkcs8_one_asymmetric_key_der(),
        cert.validity_not_before(),
        cert.validity_not_after(),
    ))
}
