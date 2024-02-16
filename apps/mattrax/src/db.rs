// This file was generated by '@mattrax/drizzle-to-rs'
#![allow(unused)]

use chrono::NaiveDateTime;
use mysql_async::prelude::*;

#[derive(Debug)]
pub struct GetCertificateResult {
    pub certificate: Vec<u8>,
}

#[derive(Clone)]
pub struct Db {
    pool: mysql_async::Pool,
}
impl Db {
    pub fn new(db_url: &str) -> Self {
        Self {
            pool: mysql_async::Pool::new(db_url),
        }
    }
}
impl Db {
    pub async fn get_certificate(
        &self,
        key: String,
    ) -> Result<Vec<GetCertificateResult>, mysql_async::Error> {
        r#"select `certificate` from `certificates` where `certificates`.`key` = ?"#
            .with(mysql_async::Params::Positional(vec![key.clone().into()]))
            .map(&self.pool, |p: (Vec<u8>,)| GetCertificateResult {
                certificate: p.0,
            })
            .await
    }
}
impl Db {
    pub async fn store_certificate(
        &self,
        key: String,
        certificate: Vec<u8>,
        last_modified: NaiveDateTime,
    ) -> Result<(), mysql_async::Error> {
        r#"insert into `certificates` (`key`, `certificate`, `lastModified`) values (?, ?, ?) on duplicate key update `certificate` = ?, `lastModified` = ?"#
            .with(mysql_async::Params::Positional(vec![key.clone().into(),certificate.clone().into(),last_modified.clone().into(),certificate.clone().into(),last_modified.clone().into()]))
            .run(&self.pool)
            .await
            .map(|_| ())
    }
}
