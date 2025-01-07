use axum::{extract::State, routing::post, Json, Router};
use serde::Deserialize;

use crate::Core;

#[derive(Deserialize)]
pub struct CreateTenantRequest {
    pub name: String,
}

pub(crate) fn mount() -> Router<Core> {
    Router::new().route(
        "/",
        post(
            |State(core): State<Core>, body: Json<CreateTenantRequest>| async move {
                // core.db.tenant.create(body.name).await;
                // sqlx::query!("INSERT INTO tenant(id, name, apns_key) VALUES(?, ?, ?)")
                //     .execute(&core.db)
                //     .await
                //     .unwrap();

                // let tenant = core.tenant.create(body.name).await;

                // (axum::http::StatusCode::CREATED, Json(tenant))
                todo!();
            },
        ),
    )
    // TODO: Get tenant
    // TODO: Get csr
    // TODO: Update tenant & Apple CSR
    // TODO: Delete tenant
}
