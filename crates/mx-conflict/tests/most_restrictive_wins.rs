use std::collections::HashMap;

use mx_dmvalue::DmValue;
use mx_graph::{Configuration, ConflictResolutionStrategy, Deploy, Graph};

mod util;

#[test]
fn most_restrictive_wins() {
    let mut graph = Graph::default();

    graph.add(Deploy {
        pk: 0,
        priority: 0,
        configuration: HashMap::from([(
            String::from("./Mattrax/Node"),
            Configuration {
                key: "a".into(),
                value: DmValue::Boolean(true),
                conflict_resolution_strategy: ConflictResolutionStrategy::InValueOrder(vec![
                    DmValue::Boolean(false),
                    DmValue::Boolean(true),
                ]),
            },
        )]),
    });

    // We set the same configuration again, but with a more restrictive policy so it will take precedence
    graph.add(Deploy {
        pk: 1,
        priority: 0,
        configuration: HashMap::from([(
            String::from("./Mattrax/Node"),
            Configuration {
                key: "a".into(),
                value: DmValue::Boolean(false),
                conflict_resolution_strategy: ConflictResolutionStrategy::InValueOrder(vec![
                    DmValue::Boolean(false),
                    DmValue::Boolean(true),
                ]),
            },
        )]),
    });

    util::assert_graph_eq(
        &graph,
        r#"{"n":{"./Mattrax/Node":{"Node":{"strategy":{"InValueOrder":[{"Boolean":false},{"Boolean":true}]},"values":[[{"Boolean":true},[{"deploy_pk":0,"key":"a"}]]]}}}}"#,
    );

    // TODO: Actually assert the result is `false` not `true`
}

#[test]
fn mismatched_conflict_resolution_strategy() {
    let mut graph = Graph::default();

    graph.add(Deploy {
        pk: 0,
        priority: 0,
        configuration: HashMap::from([(
            String::from("./Mattrax/Node"),
            Configuration {
                key: "a".into(),
                value: DmValue::Boolean(true),
                conflict_resolution_strategy: ConflictResolutionStrategy::InValueOrder(vec![
                    DmValue::Boolean(false),
                    DmValue::Boolean(true),
                ]),
            },
        )]),
    });

    // We set the same configuration again, but with a different `conflict_resolution_strategy`
    graph.add(Deploy {
        pk: 1,
        priority: 0,
        configuration: HashMap::from([(
            String::from("./Mattrax/Node"),
            Configuration {
                key: "a".into(),
                value: DmValue::Boolean(false),
                conflict_resolution_strategy: ConflictResolutionStrategy::Conflict,
            },
        )]),
    });

    util::assert_graph_eq(
        &graph,
        r#"{"c":[{"node":"./Mattrax/Node","cause":"e","references":[{"deploy_pk":0,"key":"a"},{"deploy_pk":1,"key":"a"}]}]}"#,
    );
}

#[test]
fn mismatched_in_value_order_conflict_resolution_strategy() {
    let mut graph = Graph::default();

    graph.add(Deploy {
        pk: 0,
        priority: 0,
        configuration: HashMap::from([(
            String::from("./Mattrax/Node"),
            Configuration {
                key: "a".into(),
                value: DmValue::Boolean(true),
                conflict_resolution_strategy: ConflictResolutionStrategy::InValueOrder(vec![
                    DmValue::Boolean(true),
                    DmValue::Boolean(false),
                ]),
            },
        )]),
    });

    // We set the same configuration again, but with a different order within `ConflictResolutionStrategy::InValueOrder`
    graph.add(Deploy {
        pk: 1,
        priority: 0,
        configuration: HashMap::from([(
            String::from("./Mattrax/Node"),
            Configuration {
                key: "a".into(),
                value: DmValue::Boolean(false),
                conflict_resolution_strategy: ConflictResolutionStrategy::InValueOrder(vec![
                    DmValue::Boolean(false),
                    DmValue::Boolean(true),
                ]),
            },
        )]),
    });

    util::assert_graph_eq(
        &graph,
        r#"{"c":[{"node":"./Mattrax/Node","cause":"i","references":[{"deploy_pk":0,"key":"a"},{"deploy_pk":1,"key":"a"}]}]}"#,
    );
}
