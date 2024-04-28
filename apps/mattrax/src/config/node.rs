use serde::{Deserialize, Serialize};

/// Configuration for a specific node in a Mattrax installation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    /// The running version of Mattrax on this node.
    pub version: String,
}
