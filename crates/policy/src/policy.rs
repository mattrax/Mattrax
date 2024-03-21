use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Policy {
    // id: Uuid,
    pub name: String,
}

// pub enum PolicyType {}
