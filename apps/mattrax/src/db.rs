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
            .with(mysql_async::Params::Positional(vec![key.clone().into(),certificate.clone().into(),"[object Object]".into(),certificate.clone().into(),"[object Object]".into()]))
            .run(&self.pool)
            .await
            .map(|_| ())
    }
}
impl Db {
    pub async fn create_device(
        &self,
        id: String,
        name: String,
        operating_system: String,
        serial_number: String,
        tenant_pk: i32,
    ) -> Result<(), mysql_async::Error> {
        r#"insert into `devices` (`id`, `cuid`, `name`, `description`, `operatingSystem`, `serialNumber`, `manufacturer`, `model`, `osVersion`, `imei`, `freeStorageSpaceInBytes`, `totalStorageSpaceInBytes`, `owner`, `azureADDeviceId`, `enrolledAt`, `lastSynced`, `tenantId`, `groupableVariant`) values (default, ?, ?, default, ?, ?, default, default, default, default, default, default, default, default, default, default, ?, ?)"#
            .with(mysql_async::Params::Positional(vec![id.clone().into(),name.clone().into(),operating_system.clone().into(),serial_number.clone().into(),tenant_pk.clone().into(),"device".into()]))
            .run(&self.pool)
            .await
            .map(|_| ())
    }
}
