use axum::Router;

use crate::Core;

pub(crate) fn mount() -> Router<Core> {
    Router::new()
}
