//! Mattrax policy graph system.
//!
//! Why a graph?
//! We can add/remove a policy deploy from the graph and determine the impact on the result, without loading all policy deploys.
//!
//! We work out what to deploy, by looking up only the configurations that appear in the result of the graph and then applying them.
//!

mod deploy;
mod graph;
mod result;

// pub use deploy::{Configuration, ConflictResolutionStrategy, Deploy};
// pub use graph::{Conflict, Graph, Reference};
// pub use result::Result;
