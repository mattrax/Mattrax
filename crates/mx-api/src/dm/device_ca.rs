use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use mx_crypto::x509::{Certificate, ExtendedKeyUsage, KeyUsage, PrivateKey, SubjectBuilder};
use sqlx::{query, query_as};
use tokio::{
    runtime::{Handle, Runtime},
    task::spawn_blocking,
};
use tracing::info;

use crate::{
    utils::{decrypt, encrypt, Cached},
    Core,
};

#[derive(Clone, Debug)]
struct IdentityRow {
    id: u64,
    cert: Vec<u8>,
    key: Vec<u8>,
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

    pub fn active_signer(&self, core: &Core) -> Option<(Certificate, PrivateKey)> {
        let value = self.0.get();
        if value.is_empty() {
            // Self::refresh(core);
            todo!();
        }

        // TODO: We need to account for caching so this should be delayed unless it's the only one.
        let first = value.last()?;
        let cert = Certificate::from_der(&first.cert).unwrap();
        let keypair =
            PrivateKey::from_pkcs8_der(&decrypt(&*core.secret, &first.key[..]).unwrap()).unwrap();
        Some((cert, keypair))
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
    // TODO: Refresh cache and use it instead of this query?
    let active_identities = query!(
        "SELECT id, not_after FROM identity WHERE CURRENT_TIMESTAMP() BETWEEN not_before AND not_after"
    )
    .fetch_all(&core.db)
    .await?;

    let must_refresh = active_identities.len() == 0
        || active_identities.iter().any(|identity| {
            let remaining = identity.not_after.signed_duration_since(chrono::Utc::now());
            // println!("A {:?}", remaining.num_seconds());
            remaining.num_seconds() < 60 * 60 * 24 * 7 // TODO: Configure this for dev
        });

    if must_refresh {
        info!("Detected that the device CA needs to be refreshed...");
        let (cert, key, not_before, not_after) = issue_device_ca().await.unwrap();

        let key = encrypt(&core.secret, &key[..]).unwrap();

        // Using the database we set the primary key of the table to the closest 5 minute interval in epoch.
        // We also configure the query to not update the row if it already exists.
        // This means if multiple clients attempt to refresh the device CA at once, only one of them will succeed.
        // It's undefined which one so we can't use the result of `issue_root` without going back to the database.
        // This system very intentionally relys on the database time to avoid any client side time drift causing issues.
        query!(
            "INSERT INTO identity(id, cert, `key`, not_before, not_after) VALUES (UNIX_TIMESTAMP() - (UNIX_TIMESTAMP() % 300), ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id=id",
            cert,
            key,
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

/// The amount of seconds in a day.
static DAY: u64 = 60 * 60 * 24;

/// The amount of the time the device CA is valid for.
static DEVICE_CA_VALIDITY: Duration = if cfg!(debug_assertions) {
    // We significantly reduce the validity in debug mode so we can spot bugs easier.
    Duration::from_secs(1 * DAY)
} else {
    Duration::from_secs(365 * DAY)
};

async fn issue_device_ca() -> Result<
    (
        Vec<u8>,
        Vec<u8>,
        chrono::DateTime<chrono::Utc>,
        chrono::DateTime<chrono::Utc>,
    ),
    (),
> {
    // This can take a while and we don't want to block the runtime (can break Ctrl + C)
    let key = spawn_blocking(|| PrivateKey::generate_rsa(4096).unwrap())
        .await
        .unwrap();
    let cert = Certificate::builder()
        .subject(SubjectBuilder::default().common_name("Mattrax Device CA"))
        .validity(DEVICE_CA_VALIDITY)
        .is_ca(true)
        .key_usage(KeyUsage::KEY_CERT_SIGN | KeyUsage::CRL_SIGN)
        .self_sign(&key)
        .unwrap();

    // TODO: Remove
    // std::fs::write("./bruh.pem", cert.encode_pem()).unwrap();
    // let cert = std::fs::read("./openssl/crt.pem").unwrap();
    // let cert = Certificate::from_pem(&cert).unwrap();
    // cert.extensions().for_each(|e| {
    //     println!(
    //         "\t {:?} {:?} {:?}",
    //         e.id.0.to_vec(),
    //         e.value.as_slice().unwrap(),
    //         "todo" // u16::from_be_bytes(e.value.as_slice().unwrap().try_into().unwrap())
    //     );
    // });

    Ok((
        cert.encode_der().unwrap(),
        key.to_pkcs8_der().unwrap(),
        cert.not_before(),
        cert.not_after(),
    ))
}
