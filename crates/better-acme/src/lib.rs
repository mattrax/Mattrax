//! The better ACME library for Rust.
//!
//! Why?
//!  - On the fly domains (rustls-acme is locked to one certificate)
//!  - Stateless design (rustls-acme doesn't have a configurable storage for challenges)
//!

mod acme;
mod fs_store;
mod server;
mod store;

pub use acme::{AcceptorAction, Acme};
pub use fs_store::FsStore;
pub use server::Server;
pub use store::Store;
