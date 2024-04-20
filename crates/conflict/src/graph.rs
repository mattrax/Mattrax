use std::collections::{BTreeMap, HashMap};

use mx_dmvalue::DmValue;

use crate::{ConflictResolutionStrategy, Deploy};

// The order policies are applied to the graph should not affect the result -> So we need to sort everything.

#[derive(Debug, PartialEq, Eq)]
pub struct Graph {
    nodes: BTreeMap<String, Child>,
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

                // If this policies attempts to set the same value we can just add a reference as it won't conflict.
                if let Some(references) = node.values.get_mut(&config.value) {
                    references.push(Reference {
                        deploy_pk: deploy.pk,
                        key: config.key,
                    });
                    continue;
                }

                // TODO: Datatype conflicts

                match (config.conflict_resolution_strategy, &node.strategy) {
                    (
                        ConflictResolutionStrategy::InValueOrder(a),
                        ConflictResolutionStrategy::InValueOrder(b),
                    ) => {
                        // If the definition of the most restrictive policy is different we can reconcile it.
                        // So we remove the node from the result and mark it as a conflict.
                        if a != *b {
                            let Child::Node(node) = self
                                .nodes
                                .remove(&oma_uri)
                                .expect("we check it exists and have exclusive access");

                            let mut references = node
                                .values
                                .into_iter()
                                .map(|(_, v)| v)
                                .flatten()
                                .collect::<Vec<_>>();

                            references.push(Reference {
                                deploy_pk: deploy.pk,
                                key: config.key,
                            });
                            self.conflicts.push(Conflict {
                                node: oma_uri,
                                cause: ConflictCause::InvalidInValueOrderDefinition,
                                references: references,
                            });
                            continue;
                        }

                        // TODO: If datatype doesn't match error out

                        // TODO: If value is in the same bucket we can just add the reference

                        node.values
                            .get_mut(&config.value)
                            .get_or_insert(&mut Default::default())
                            .push(Reference {
                                deploy_pk: deploy.pk,
                                key: config.key,
                            });
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

                        let Child::Node(node) = self
                            .nodes
                            .remove(&oma_uri)
                            .expect("we check it exists and have exclusive access");

                        let mut references = node
                            .values
                            .into_iter()
                            .map(|(_, v)| v)
                            .flatten()
                            .collect::<Vec<_>>();

                        references.push(Reference {
                            deploy_pk: deploy.pk,
                            key: config.key,
                        });
                        self.conflicts.push(Conflict {
                            node: oma_uri,
                            cause: ConflictCause::ExplicitConflict,
                            references: references,
                        });
                    }
                }
            } else {
                self.nodes.insert(
                    oma_uri,
                    Child::Node(Node {
                        strategy: config.conflict_resolution_strategy,
                        values: HashMap::from([(
                            config.value.clone(),
                            vec![Reference {
                                deploy_pk: deploy.pk,
                                key: config.key,
                            }],
                        )]),
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

#[derive(Debug, PartialEq, Eq)]
enum Child {
    // TODO: Use edges between nodes instead of full URI as the key so it's more efficient to store
    // Edge(BTreeMap<String, Child>),
    Node(Node),
}

#[derive(Debug, PartialEq, Eq)]
struct Node {
    strategy: ConflictResolutionStrategy,
    values: HashMap<DmValue, Vec<Reference>>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Reference {
    deploy_pk: u64,
    key: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Conflict {
    node: String,
    cause: ConflictCause,
    references: Vec<Reference>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConflictCause {
    /// A multiple configurations setting this node were marked as [ConflictResolutionStrategy::InValueOrder] but had conflicting definitions of the most restrictive policy.
    InvalidInValueOrderDefinition,
    /// A configuration setting this node was marked as [ConflictResolutionStrategy::Conflict] and multiple nodes were found.
    ExplicitConflict,
}
