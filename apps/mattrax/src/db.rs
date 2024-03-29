// This file was generated by '@mattrax/drizzle-to-rs'
#![allow(unused)]

use chrono::NaiveDateTime;
use mysql_async::prelude::*;

#[derive(Debug)]
pub struct GetCertificateResult {
    pub certificate: Vec<u8>,
}

#[derive(Debug)]
pub struct GetDevicePoliciesResult {
    pub pk: u64,
    pub id: String,
    pub name: String,
}
#[derive(Debug)]
pub struct GetPolicyLatestVersionResult {
    pub pk: u64,
    pub data: mysql_async::Deserialized<serde_json::Value>,
}
#[derive(Debug)]
pub struct GetDeviceResult {
    pub pk: u64,
    pub tenant_pk: u64,
}

#[derive(Debug)]
pub struct QueuedDeviceActionsResult {
    pub action: String,
    pub device_pk: u64,
    pub created_by: u64,
    pub created_at: NaiveDateTime,
    pub deployed_at: Option<NaiveDateTime>,
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
        r#"insert into `certificates` (`key`, `certificate`, `last_modified`) values (?, ?, ?) on duplicate key update `certificate` = ?, `last_modified` = ?"#
            .with(mysql_async::Params::Positional(vec![key.clone().into(),certificate.clone().into(),last_modified.clone().into(),certificate.clone().into(),last_modified.clone().into()]))
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
        enrollment_type: String,
        os: String,
        serial_number: String,
        tenant_pk: u64,
        owner_pk: u64,
    ) -> Result<(), mysql_async::Error> {
        r#"insert into `devices` (`pk`, `id`, `name`, `description`, `enrollment_type`, `os`, `serial_number`, `manufacturer`, `model`, `os_version`, `imei`, `free_storage`, `total_storage`, `owner`, `azure_ad_did`, `enrolled_at`, `last_synced`, `tenant`) values (default, ?, ?, default, ?, ?, ?, default, default, default, default, default, default, ?, default, default, default, ?) on duplicate key update `name` = ?, `tenant` = ?, `owner` = ?"#
            .with(mysql_async::Params::Positional(vec![id.clone().into(),name.clone().into(),enrollment_type.clone().into(),os.clone().into(),serial_number.clone().into(),owner_pk.clone().into(),tenant_pk.clone().into(),name.clone().into(),tenant_pk.clone().into(),owner_pk.clone().into()]))
            .run(&self.pool)
            .await
            .map(|_| ())
    }
}
impl Db {
    pub async fn get_device_policies(
        &self,
        device_id: u64,
    ) -> Result<Vec<GetDevicePoliciesResult>, mysql_async::Error> {
        r#"(select `policies`.`pk`, `policies`.`id`, `policies`.`name` from `policies` inner join `policy_assignables` on `policies`.`pk` = `policy_assignables`.`policy` where (`policy_assignables`.`variant` = ? and `policy_assignables`.`pk` = ?)) union (select `policies`.`pk`, `policies`.`id`, `policies`.`name` from `policies` inner join `policy_assignables` on `policies`.`pk` = `policy_assignables`.`policy` inner join `group_assignables` on (`group_assignables`.`group` = `policy_assignables`.`pk` and `policy_assignables`.`variant` = ?) where (`group_assignables`.`variant` = ? and `group_assignables`.`pk` = ?))"#
            .with(mysql_async::Params::Positional(vec!["device".into(),device_id.clone().into(),"group".into(),"device".into(),device_id.clone().into()]))
            .map(&self.pool, |p: (u64,String,String,)| GetDevicePoliciesResult {
                pk: p.0,id: p.1,name: p.2
              })
            .await
    }
}
impl Db {
    pub async fn get_policy_latest_version(
        &self,
        policy_id: u64,
    ) -> Result<Vec<GetPolicyLatestVersionResult>, mysql_async::Error> {
        r#"select `pk`, `data` from `policy_deploy` where `policy_deploy`.`policy` = ? order by `policy_deploy`.`done_at` desc limit ?"#
            .with(mysql_async::Params::Positional(vec![policy_id.clone().into(),1.into()]))
            .map(&self.pool, |p: (u64,mysql_async::Deserialized<serde_json::Value>,)| GetPolicyLatestVersionResult {
                pk: p.0,data: p.1
              })
            .await
    }
}
impl Db {
    pub async fn get_device(
        &self,
        device_id: String,
    ) -> Result<Vec<GetDeviceResult>, mysql_async::Error> {
        r#"select `pk`, `tenant` from `devices` where `devices`.`id` = ?"#
            .with(mysql_async::Params::Positional(vec![device_id
                .clone()
                .into()]))
            .map(&self.pool, |p: (u64, u64)| GetDeviceResult {
                pk: p.0,
                tenant_pk: p.1,
            })
            .await
    }
}
impl Db {
    pub async fn update_device_lastseen(
        &self,
        device_id: u64,
        last_synced: NaiveDateTime,
    ) -> Result<(), mysql_async::Error> {
        r#"update `devices` set `last_synced` = ? where `devices`.`pk` = ?"#
            .with(mysql_async::Params::Positional(vec![
                last_synced.clone().into(),
                device_id.clone().into(),
            ]))
            .run(&self.pool)
            .await
            .map(|_| ())
    }
}
impl Db {
    pub async fn queued_device_actions(
        &self,
        device_id: u64,
    ) -> Result<Vec<QueuedDeviceActionsResult>, mysql_async::Error> {
        r#"select `action`, `device`, `created_by`, `created_at`, `deployed_at` from `device_actions` where (`device_actions`.`device` = ? and `device_actions`.`deployed_at` is null)"#
            .with(mysql_async::Params::Positional(vec![device_id.clone().into()]))
            .map(&self.pool, |p: (String,u64,u64,NaiveDateTime,Option<NaiveDateTime>,)| QueuedDeviceActionsResult {
                action: p.0,device_pk: p.1,created_by: p.2,created_at: p.3,deployed_at: p.4
              })
            .await
    }
}
