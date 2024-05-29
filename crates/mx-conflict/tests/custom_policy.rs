// use std::collections::HashMap;

// use mx_dmvalue::DmValue;
// use mx_graph::{Configuration, ConflictResolutionStrategy, Deploy, Graph};

// mod util;

// #[test]
// fn custom_policy_conflicting_value() {
//     let mut graph = Graph::default();

//     graph.add(Deploy {
//         pk: 0,
//         priority: 0,
//         configuration: HashMap::from([(
//             String::from("./Mattrax/Node"),
//             Configuration {
//                 key: "a".into(),
//                 value: DmValue::Boolean(true),
//                 conflict_resolution_strategy: ConflictResolutionStrategy::Conflict,
//             },
//         )]),
//     });
//     graph.add(Deploy {
//         pk: 1,
//         priority: 0,
//         configuration: HashMap::from([(
//             String::from("./Mattrax/Node"),
//             Configuration {
//                 key: "a".into(),
//                 value: DmValue::Boolean(false),
//                 conflict_resolution_strategy: ConflictResolutionStrategy::Conflict,
//             },
//         )]),
//     });

//     util::assert_graph_eq(
//         &graph,
//         r#"{"c":[{"node":"./Mattrax/Node","cause":"e","references":[{"deploy_pk":0,"key":"a"},{"deploy_pk":1,"key":"a"}]}]}"#,
//     );
// }

// // TODO: Multiple properties in a single `WindowsConfiguration::Custom`
