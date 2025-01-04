//! Getting the issuer certificate for SCEP:
//!  - Generate certificate + keypair
//!
//!  - Insert into the database
//!
//!
//!
//! Getting all valid certificates for validating MDM requests:
//!
//!
//! TODO: Explaing the flow
//!
//!  - Disable caching when no valid certs
//!  - All driven by the CRON function
//!
//! TODO: Caching
//! TODO: Create a new identity, get all identities, get the active identity.

use chrono::{DateTime, Utc};
use sqlx::prelude::*;

#[derive(Debug, FromRow)]
pub struct Identity {
    pub id: i32,
    pub cert: Vec<u8>,
    pub key: Vec<u8>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Identity {
    // pub fn save(&self, db: &sqlx::MySqlPool) -> Result<(), sqlx::Error> {
    //     todo!()
    // }

    // pub fn get_all(db: &sqlx::MySqlPool) -> Result<Vec<Identity>, sqlx::Error> {
    //     todo!()
    // }

    // TODO: What if certificates age is going to outlive the issuer?
    // TODO: How do we renew the certificates?

    pub fn todo() {
        // TODO: Caching
        loop {
            // Get valid certificates
            let certs = vec![()];

            // If none, generate a new one
            if certs.is_empty() {
                // Generate one

                // Insert into the database

                // TODO: If multiple clients do this at once, we might end up with multiple certificates, although only one will be used.

                // TODO: Explain why we refetch from the DB
                continue;
            }

            // TODO: return newest active one. // TODO: Maybe only 5 mins after being issued to account for cache propogation???
        }
    }
}
