use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::{ConflictResolutionStrategy, Deploy};

// The order policies are applied to the graph should not affect the result -> So we need to sort everything.

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Graph {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty", rename = "n")]
    nodes: BTreeMap<String, Child>,
    #[serde(default, skip_serializing_if = "Vec::is_empty", rename = "c")]
    conflicts: Vec<Conflict>,
}

impl Default for Graph {
    fn default() -> Self {
        Self {
            nodes: Default::default(),
            conflicts: Default::default(),
        }
    }
}

impl Graph {
    pub fn add(&mut self, deploy: Deploy) {
        println!("{:?}", deploy);

        for (oma_uri, config) in deploy.configuration {
            if let Some(entry) = self.nodes.get_mut(&oma_uri) {
                let Child::Node(node) = entry;

                // TODO: If the values match skip the conflict resolution stuff

                match (config.conflict_resolution_strategy, &node.strategy) {
                    (
                        ConflictResolutionStrategy::InValueOrder(a),
                        ConflictResolutionStrategy::InValueOrder(b),
                    ) => {
                        // If the definition of the most restrictive policy is different we can reconcile it.
                        // So we remove the node from the result and mark it as a conflict.
                        if a != *b {
                            let Child::Node(mut node) = self
                                .nodes
                                .remove(&oma_uri)
                                .expect("we check it exists and have exclusive access");

                            node.references.push(Reference {
                                deploy_pk: deploy.pk,
                                key: config.key,
                            });
                            self.conflicts.push(Conflict {
                                node: oma_uri,
                                cause: ConflictCause::InvalidInValueOrderDefinition,
                                references: node.references,
                            });
                        }

                        // TODO: If datatype doesn't match error out

                        // TODO: If value is in the same bucket we can just add the reference

                        todo!();
                    }
                    (
                        ConflictResolutionStrategy::InValueOrder(_),
                        ConflictResolutionStrategy::Conflict,
                    )
                    | (
                        ConflictResolutionStrategy::Conflict,
                        ConflictResolutionStrategy::InValueOrder(_),
                    )
                    | (
                        ConflictResolutionStrategy::Conflict,
                        ConflictResolutionStrategy::Conflict,
                    ) => {
                        // If either is marked as conflict we can reconcile it.
                        // So we remove the node from the result and mark it as a conflict.

                        let Child::Node(mut node) = self
                            .nodes
                            .remove(&oma_uri)
                            .expect("we check it exists and have exclusive access");

                        node.references.push(Reference {
                            deploy_pk: deploy.pk,
                            key: config.key,
                        });
                        self.conflicts.push(Conflict {
                            node: oma_uri,
                            cause: ConflictCause::ExplicitConflict,
                            references: node.references,
                        });
                    }
                }
            } else {
                self.nodes.insert(
                    oma_uri,
                    Child::Node(Node {
                        strategy: config.conflict_resolution_strategy,
                        references: vec![Reference {
                            deploy_pk: deploy.pk,
                            key: config.key,
                        }],
                    }),
                );
            }
        }
    }

    // pub fn remove(&mut self, deploy: Deploy) {
    //     todo!();
    // }

    pub fn result(&self) -> HashMap<String, Reference> {
        todo!();
    }
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
enum Child {
    // TODO: Use edges between nodes instead of full URI as the key so it's more efficient to store
    // Edge(BTreeMap<String, Child>),
    Node(Node),
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Node {
    strategy: ConflictResolutionStrategy,
    // TODO: Probs bucket by similar values so we can detect changes just from the graph
    references: Vec<Reference>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reference {
    deploy_pk: u64,
    key: String,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Conflict {
    node: String,
    cause: ConflictCause,
    references: Vec<Reference>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConflictCause {
    /// A multiple configurations setting this node were marked as [ConflictResolutionStrategy::InValueOrder] but had conflicting definitions of the most restrictive policy.
    #[serde(rename = "i")]
    InvalidInValueOrderDefinition,
    /// A configuration setting this node was marked as [ConflictResolutionStrategy::Conflict] and multiple nodes were found.
    #[serde(rename = "e")]
    ExplicitConflict,
}
