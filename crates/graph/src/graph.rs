use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

// The order policies are applied to the graph should not affect the result.

/// TODO: Explain this
#[derive(Debug)]
pub struct Graph {
    nodes: BTreeMap<String, Child>,
}

impl Default for Graph {
    fn default() -> Self {
        Self {
            nodes: Default::default(),
        }
    }
}

impl Graph {
    // pub fn attach_group(&mut self, parent: Graph) {
    //     todo!();
    // }

    // pub fn add(&mut self, deploy: Deploy) {
    //     todo!();
    // }

    // pub fn remove(&mut self, deploy: Deploy) {
    //     todo!();
    // }

    pub fn result(&self) -> HashMap<String, Reference> {
        todo!();
    }
}

#[derive(Debug)]
enum Child {
    Edge(BTreeMap<String, Child>),
    Node(Node),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "t")]
enum Node {
    #[serde(rename = "b")]
    Bool(BTreeMap<bool, Reference>),
    #[serde(rename = "i")]
    Int(BTreeMap<i64, Vec<Reference>>),
    #[serde(rename = "b")]
    Values(Vec<Reference>),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Reference {
    deploy_pk: u64,
    key: String,
}
