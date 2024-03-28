//! The Mattrax policy definition.

mod configuration;
mod platform;
mod policy;
mod script;

pub use configuration::Configuration;
pub use platform::Platform;
pub use policy::Policy;
pub use script::Script;

/// TODO
pub type SupportMatrix = (); // TODO: Work this out
