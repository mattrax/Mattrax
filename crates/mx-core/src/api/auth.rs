use rspc_openapi::OpenAPI;

use crate::util::{BaseProcedure, Router};

pub fn mount() -> Router {
    Router::new().procedure("get", {
        <BaseProcedure>::builder()
            .with(OpenAPI::get("/login").build())
            .query(|ctx, _: ()| async move {
                // TODO

                Ok("Hello From rspc!")
            })
    })
    // TODO: Doing authentication w/ existing frontend
}
