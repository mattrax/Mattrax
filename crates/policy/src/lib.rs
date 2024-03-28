//! The Mattrax policy definition.

mod configuration;
mod platform;
mod policy;

pub mod android;
pub mod apple;
pub mod script;
pub mod windows;

pub use configuration::Configuration;
pub use platform::Platform;
pub use policy::Policy;

/// TODO
pub type SupportMatrix = (); // TODO: Work this out
