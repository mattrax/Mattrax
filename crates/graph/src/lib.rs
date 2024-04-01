//! Mattrax policy graph system.
//!
//! Why a graph?
//! We can add/remove a policy deploy from the graph and determine the impact on the result, without loading all policy deploys.
//!
//! We work out what to deploy, by looking up only the configurations that appear in the result of the graph and then applying them.
//!

mod deploy;
mod graph;

pub use deploy::Deploy;
pub use graph::{Graph, Reference};

// TODO: public the stuff that needs it
