//! This file defines an abstraction representation of some Mattrax types for the graph to operate on.
//!
//! This is done so we can keep the graph implementation decoupled from the DB and policy rendering code.
//!

use std::collections::HashMap;

use mx_dmvalue::DmValue;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct Deploy {
    // Primary key of the deploy
    pub pk: u64,
    // Priority of the policy
    pub priority: u8,
    // The rendered MDM configuration
    // TODO: Should this not a `HashMap` so all conflict resolution can be let to the graph?
    pub configuration: HashMap<String, Configuration>,
}

#[derive(Debug, Clone)]
pub struct Configuration {
    /// The configuration JSON key
    pub key: String,
    /// The value the OMA-URI node was set to
    pub value: DmValue,
    /// The conflict resolution strategy to use when a conflict is hit
    pub conflict_resolution_strategy: ConflictResolutionStrategy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConflictResolutionStrategy {
    /// When a conflict is hit, the most restrictive value will be set (based on the order of the `Vec`)
    InValueOrder(Vec<DmValue>),
    /// When a conflict is hit, the value will not be set and it's left to the administrator to figure it out.
    Conflict,
}
