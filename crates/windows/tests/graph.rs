use std::collections::HashMap;

use mx_graph::{Deploy, Graph};
use mx_policy::{
    windows::{AnyValue, CustomConfiguration, WindowsConfiguration},
    Configuration,
};
use serde::de::DeserializeOwned;

fn from_str<T: DeserializeOwned>(s: &str) -> T {
    serde_json::from_str(s).unwrap()
}

// A custom policy, with a conflicting value should result in:
// - neither being applied
// - a conflict being reported
#[test]
fn custom_policy_conflicting_value() {
    let mut graph = Graph::default();

    // graph.add(Deploy {
    //     pk: 0,
    //     data: HashMap::from([(
    //         String::from("no_graphing_calculator_nerd"),
    //         Configuration::Windows(
    //             vec![CustomConfiguration {
    //                 oma_uri: "./FakeNode".into(),
    //                 value: AnyValue::Int(0),
    //             }]
    //             .into(),
    //         ),
    //     )]),
    // });
    // graph.add(Deploy {
    //     pk: 0,
    //     data: HashMap::from([(
    //         String::from("no_graphing_calculator_nerd"),
    //         Configuration::Windows(
    //             vec![CustomConfiguration {
    //                 oma_uri: "./FakeNode".into(),
    //                 value: AnyValue::Int(1),
    //             }]
    //             .into(),
    //         ),
    //     )]),
    // });

    panic!("{:#?}", graph); // TODO
}

// TODO: Multiple properties in a single `WindowsConfiguration::Custom`
