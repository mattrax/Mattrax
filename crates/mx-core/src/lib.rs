use rspc_openapi::OpenAPI;
use util::{BaseProcedure, Router};

mod api;
mod util;

pub use util::Context;

/// Construct the [rspc::Router] for the Mattrax API.
pub fn mount() -> Router {
    let mut r = Router::new().procedure("get", {
        <BaseProcedure>::builder()
            .with(OpenAPI::get("/version").build())
            .query(|_, _: ()| async move { Ok(env!("CARGO_PKG_VERSION")) })
    });
    for (name, mount) in api::ROUTERS.iter() {
        r = r.merge(*name, mount());
    }
    r
}
