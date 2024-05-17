//! Mattrax database.
//!
//! `db.rs` is generated from Drizzle code defined Typescript (`rust.ts`).
//! `migrations.rs` is generated from the SQL migration files.
//!

mod _migrations;
mod db;

pub use _migrations::migrations;
pub use db::*;
pub use mysql_async::Serialized;
