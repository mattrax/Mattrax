use mx_graph::Graph;
use pretty_assertions::assert_eq;

#[track_caller]
pub fn assert_graph_eq(graph: &Graph, result: &str) {
    if serde_json::to_string(&graph).unwrap() != result {
        println!("{}", serde_json::to_string(&graph).unwrap());
        assert_eq!(
            // We attempt to prettify the string
            serde_json::from_str::<serde_json::Value>(result)
                .and_then(|v| serde_json::to_string_pretty(&v))
                .as_deref()
                .unwrap_or(result),
            serde_json::to_string_pretty(&graph).unwrap(),
        );
    }
}
