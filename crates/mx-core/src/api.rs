use crate::util::Router;

mod auth;
mod tenant;
mod user;

pub(super) const ROUTERS: &[(&'static str, fn() -> Router)] = &[
    ("auth", auth::mount),
    ("tenant", tenant::mount),
    ("user", user::mount),
];
