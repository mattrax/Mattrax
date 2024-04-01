use ms_mdm::{SyncBodyChild, SyncML};

pub(crate) async fn handler(cmd: &SyncML) -> Vec<SyncBodyChild> {
    // TODO: Policies
    // - get scoped groups
    //     - get policies
    //       - get latest versions
    //     - merge each version into the graph
    //     - store the graph
    // - get policies for device
    //      - merge each group into the graph
    //      - merge the extras into the graph
    // - apply the graph

    vec![]
}
