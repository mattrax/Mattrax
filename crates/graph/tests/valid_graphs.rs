use std::collections::HashMap;

use mx_dmvalue::DmValue;
use mx_graph::{Configuration, ConflictResolutionStrategy, Deploy, Graph};

mod util;

#[test]
fn graph_with_no_overlap() {
    let mut graph = Graph::default();

    graph.add(Deploy {
        pk: 0,
        priority: 0,
        configuration: HashMap::from([(
            String::from("./Mattrax/Node"),
            Configuration {
                key: "a".into(),
                value: DmValue::Boolean(true),
                conflict_resolution_strategy: ConflictResolutionStrategy::Conflict,
            },
        )]),
    });

    graph.add(Deploy {
        pk: 0,
        priority: 0,
        configuration: HashMap::from([(
            String::from("./Mattrax/Node2"),
            Configuration {
                key: "a".into(),
                value: DmValue::Boolean(false),
                conflict_resolution_strategy: ConflictResolutionStrategy::Conflict,
            },
        )]),
    });

    util::assert_graph_eq(
        &graph,
        r#"{"n":{"./Mattrax/Node":{"Node":{"strategy":"Conflict","references":[{"deploy_pk":0,"key":"a"}]}},"./Mattrax/Node2":{"Node":{"strategy":"Conflict","references":[{"deploy_pk":0,"key":"a"}]}}}}"#,
    );
}

#[test]
fn graph_with_overlap_but_no_conflict() {
    let mut graph = Graph::default();

    graph.add(Deploy {
        pk: 0,
        priority: 0,
        configuration: HashMap::from([(
            String::from("./Mattrax/Node"),
            Configuration {
                key: "a".into(),
                value: DmValue::Boolean(true),
                conflict_resolution_strategy: ConflictResolutionStrategy::Conflict,
            },
        )]),
    });

    // This value is a different configuration setting the same value, which we don't treat as a conflict.
    graph.add(Deploy {
        pk: 1,
        priority: 0,
        configuration: HashMap::from([(
            String::from("./Mattrax/Node"),
            Configuration {
                key: "b".into(),
                value: DmValue::Boolean(true),
                conflict_resolution_strategy: ConflictResolutionStrategy::Conflict,
            },
        )]),
    });

    util::assert_graph_eq(&graph, r#""#);
}
