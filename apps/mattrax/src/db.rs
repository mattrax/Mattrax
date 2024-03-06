// This file was generated by '@mattrax/drizzle-to-rs'
#![allow(unused)]

use chrono::NaiveDateTime;
use mysql_async::prelude::*;

#[derive(Debug)]
pub struct GetCertificateResult {
    pub certificate: Vec<u8>,
}

#[derive(Debug)]
pub struct GetPoliciesForDeviceResult {
    pub pk: u64,
    pub id: String,
    pub name: String,
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
        owner_pk: i32,
    ) -> Result<(), mysql_async::Error> {
        r#"insert into `devices` (`id`, `cuid`, `name`, `description`, `operatingSystem`, `serialNumber`, `manufacturer`, `model`, `osVersion`, `imei`, `freeStorageSpaceInBytes`, `totalStorageSpaceInBytes`, `owner`, `azureADDeviceId`, `enrolledAt`, `lastSynced`, `tenantId`) values (default, ?, ?, default, ?, ?, default, default, default, default, default, default, ?, default, default, default, ?) on duplicate key update `name` = ?, `tenantId` = ?, `owner` = ?"#
            .with(mysql_async::Params::Positional(vec![id.clone().into(),name.clone().into(),operating_system.clone().into(),serial_number.clone().into(),owner_pk.clone().into(),tenant_pk.clone().into(),name.clone().into(),tenant_pk.clone().into(),owner_pk.clone().into()]))
            .run(&self.pool)
            .await
            .map(|_| ())
    }
}
impl Db {
    pub async fn get_policies_for_device(
        &self,
        device_id: i32,
    ) -> Result<Vec<GetPoliciesForDeviceResult>, mysql_async::Error> {
        r#"(select `policies`.`id`, `policies`.`cuid`, `policies`.`name` from `policies` inner join `policy_assignables` on `policies`.`id` = `policy_assignables`.`policyPk` where (`policy_assignables`.`groupableVariant` = ? and `policy_assignables`.`groupableId` = ?)) union (select `policies`.`id`, `policies`.`cuid`, `policies`.`name` from `policies` inner join `policy_assignables` on `policies`.`id` = `policy_assignables`.`policyPk` inner join `group_assignables` on (`group_assignables`.`groupId` = `policy_assignables`.`groupableId` and `policy_assignables`.`groupableVariant` = ?) where (`group_assignables`.`groupableVariant` = ? and `group_assignables`.`groupableId` = ?))"#
            .with(mysql_async::Params::Positional(vec!["device".into(),device_id.clone().into(),"group".into(),"device".into(),device_id.clone().into()]))
            .map(&self.pool, |p: (u64,String,String,)| GetPoliciesForDeviceResult {
                pk: p.0,id: p.1,name: p.2
              })
            .await
    }
}
impl Db {
    pub async fn set_device_data(
        &self,
        device_id: i32,
        key: String,
        value: String,
    ) -> Result<(), mysql_async::Error> {
        r#"insert into `device_windows_data_temp` (`id`, `key`, `key`, `deviceId`, `lastModified`) values (default, ?, ?, ?, default)"#
            .with(mysql_async::Params::Positional(vec![key.clone().into(),value.clone().into(),device_id.clone().into()]))
            .run(&self.pool)
            .await
            .map(|_| ())
    }
}
