use util::Router;

mod api;
mod util;

pub use util::Context;

/// Construct the [rspc::Router] for the Mattrax API.
pub fn mount() -> Router {
    let mut r = Router::new();
    for (name, mount) in api::ROUTERS.iter() {
        r = r.merge(*name, mount());
    }
    r
}
