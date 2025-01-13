use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use tower_cookies::Cookies;
use tracing::error;

use crate::{token::Token, Core};

#[derive(Deserialize)]
pub struct NewPolicyRequest {
    name: String,
    description: Option<String>,
}

pub(crate) fn mount() -> Router<Core> {
    Router::new()
        .route(
            "/",
            post(
                |State(core): State<Core>,
                 Path(tenant_id): Path<String>,
                 cookies: Cookies,
                 body: Json<NewPolicyRequest>| async move {
                    let token =
                        Token::from_cookies(&core, &cookies).ok_or(StatusCode::UNAUTHORIZED)?;

                    sqlx::query!(
                        "SELECT id FROM tenant INNER JOIN tenant_member ON tenant.id = tenant_member.tenant WHERE tenant_member.account = ? AND tenant.id = ?",
                        token.account_id(),
                        tenant_id,
                    )
                    .fetch_optional(&core.db)
                    .await
                    .map_err(|err| {
                        error!("Error fetching tenant from database: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?
                    .ok_or(StatusCode::NOT_FOUND)?;

                    let id = nanoid::nanoid!(12);
                    sqlx::query!(
                        "INSERT INTO policy(id, name, description, tenant) VALUES(?, ?, ?, ?)",
                        id,
                        body.name,
                        body.description,
                        tenant_id,
                    )
                    .execute(&core.db)
                    .await
                    .map_err(|err| {
                        error!("Error inserting policy into database: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?;

                    Ok::<_, StatusCode>((axum::http::StatusCode::CREATED, Json(id)))
                },
            ),
        )
        .route(
            "/",
            get(
                |State(core): State<Core>,
                 Path(tenant_id): Path<String>,
                 cookies: Cookies| async move {
                     let token =
                         Token::from_cookies(&core, &cookies).ok_or(StatusCode::UNAUTHORIZED)?;

            let policies =
                sqlx::query!(
                    "SELECT p.id, p.name, p.description, p.version, pv.data FROM policy p LEFT JOIN policy_version pv ON p.version = pv.policy INNER JOIN tenant_member ON p.tenant = tenant_member.tenant WHERE tenant_member.tenant = ? AND tenant_member.account = ?",
                    tenant_id,
                    token.account_id(),
                )
                .fetch_all(&core.db)
                .await
                .map_err(|err| {
                    error!("Error fetching policies from database: {err:?}");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;

                Ok::<_, StatusCode>(Json(policies.into_iter().map(|p| json!({
                    "id": p.id,
                    "name": p.name,
                    "description": p.description,
                    "version": p.data.as_ref().map(|_| json!({
                        "id": p.version,
                        "data": p.data,
                    }))
                    })).collect::<Vec<_>>()))
                 },
            ),
        )
        .route(
            "/{policy_id}",
            get(
                |State(core): State<Core>,
                 Path((tenant_id, policy_id)): Path<(String, String)>,
                 cookies: Cookies| async move {
                     let token =
                         Token::from_cookies(&core, &cookies).ok_or(StatusCode::UNAUTHORIZED)?;

                     let policy = sqlx::query!(
                         "SELECT p.id, p.name, p.description, p.version, pv.data FROM policy p LEFT JOIN policy_version pv ON p.version = pv.policy INNER JOIN tenant_member ON p.tenant = tenant_member.tenant WHERE tenant_member.tenant = ? AND tenant_member.account = ? AND p.id = ?",
                         tenant_id,
                         token.account_id(),
                         policy_id,
                     )
                     .fetch_optional(&core.db)
                     .await
                     .map_err(|err| {
                         error!("Error fetching policy from database: {err:?}");
                         StatusCode::INTERNAL_SERVER_ERROR
                     })?
                     .ok_or(StatusCode::NOT_FOUND)?;

                     Ok::<_, StatusCode>(Json(json!({
                         "id": policy.id,
                         "name": policy.name,
                         "description": policy.description,
                         "version": policy.data.as_ref().map(|_| json!({
                             "id": policy.version,
                             "data": policy.data,
                         }))
                     })))
                 },
            ),
        )
        .route(
            "/{policy_id}",
            patch(
                |State(core): State<Core>,
                 Path((tenant_id, policy_id)): Path<(String, String)>,
                 cookies: Cookies| async move {
                     // TODO: Set `name`, `description` and `version`

                     "todo" },
            ),
        )
        .route(
            "/{policy_id}",
            delete(
                |State(core): State<Core>,
                 Path((tenant_id, policy_id)): Path<(String, String)>,
                 cookies: Cookies| async move { "todo" },
            ),
        )
        .route(
            "/{policy_id}/versions",
            get(
                |State(core): State<Core>,
                 Path((tenant_id, policy_id)): Path<(String, String)>,
                 cookies: Cookies| async move { "todo" },
            ),
        )
        // TODO: Get all versions and restore to one
        // TODO: Remove this
        .route(
            "/{policy_id}/debug",
            get(
                |State(core): State<Core>,
                 Path((tenant_id, policy_id)): Path<(String, String)>,
                 cookies: Cookies| async move { "todo" },
            ),
        )
    // .route(
    //     "/{policy_id}",
    //     get(
    //         |Path((tenant_id, policy_id)): Path<(String, String)>| async move {
    //             println!("tenant_id: {tenant_id}, policy_id: {policy_id}");

    //             "todo"
    //         },
    //     ),
    // )
}
