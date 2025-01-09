use std::time::{Duration, SystemTime};

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::State,
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use nanoid::nanoid;
use serde::Deserialize;
use serde_json::json;
use sqlx::error::ErrorKind;
use tower_cookies::Cookies;
use tracing::error;

use crate::{token::Token, Core};

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub name: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateUserRequest {
    pub email: Option<String>,
    pub name: Option<String>,
    pub password: Option<String>,
}

pub(crate) fn mount() -> Router<Core> {
    Router::new()
        .route(
            "/login",
            post(
                |State(core): State<Core>, cookies: Cookies, Json(req): Json<LoginRequest>| async move {
                    // TODO: What is already logged in?

                    let user =
                        sqlx::query!("SELECT id, password FROM account WHERE email = ?", req.email)
                            .fetch_optional(&core.db)
                            .await
                            .map_err(|err| {
                                error!("Error fetching user from db: {err:?}");
                                StatusCode::INTERNAL_SERVER_ERROR
                            })?
                            .ok_or(StatusCode::FORBIDDEN)?;

                    Argon2::default().verify_password(req.password.as_bytes(), &PasswordHash::new(&user.password).map_err(|err| {
                        error!("Error constructing password hash for user {:?}: {err:?}", user.id);
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?)
                        .map_err(|_| StatusCode::FORBIDDEN)?;


                    let exp = SystemTime::now() + Duration::from_secs(60 * 60 * 24 * 30);
                    let exp = exp.duration_since(SystemTime::UNIX_EPOCH).map_err(|err| {
                        error!("System time is wrong: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?.as_secs();

                    Token::Authentication { sub: user.id, exp }.set(&core, &cookies);

                    Ok::<_, StatusCode>(StatusCode::NO_CONTENT)
                },
            ),
        )
        .route(
            "/register",
            post(
                |State(core): State<Core>, cookies: Cookies, Json(req): Json<RegisterRequest>| async move {
                    // TODO: What is already logged in?
                    // TODO: Verify password strength is good enough

                    let password_hash = Argon2::default()
                        .hash_password(req.password.as_bytes(), &SaltString::generate(&mut OsRng))
                        .map_err(|err| {
                            error!("Error hashing user password: {err:?}");
                            StatusCode::INTERNAL_SERVER_ERROR
                        })?
                        .to_string();

                    let name = req.name.unwrap_or_else(|| req.email.split("@").next().unwrap_or_default().into());
                    let id = nanoid!(12);
                    sqlx::query!(
                        "INSERT INTO account (id, email, password, name) VALUES (?, ?, ?, ?)",
                        id,
                        req.email,
                        password_hash,
                        name,
                    )
                    .execute(&core.db)
                    .await
                    .map_err(|err| {
                        if let sqlx::Error::Database(err) = &err {
                            if err.kind() == ErrorKind::UniqueViolation {
                                return StatusCode::CONFLICT;
                            }
                        }

                        error!("Error inserting user into db: {err:?}");
                        return StatusCode::INTERNAL_SERVER_ERROR;
                    })?;

                    let exp = SystemTime::now() + Duration::from_secs(60 * 60 * 24 * 30);
                    let exp = exp.duration_since(SystemTime::UNIX_EPOCH).map_err(|err| {
                        error!("System time is wrong: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?.as_secs();

                    Token::Authentication { sub: id, exp }.set(&core, &cookies);

                    Ok::<_, StatusCode>(StatusCode::CREATED)
                },
            ),
        )
        .route(
            "/me",
            get(|State(core): State<Core>, cookies: Cookies| async move {
                let token = Token::from_cookies(&core, &cookies).ok_or(StatusCode::UNAUTHORIZED)?;

                let me = sqlx::query!("SELECT id, name, email, created FROM account WHERE id = ?", token.account_id())
                    .fetch_one(&core.db)
                    .await
                    .map_err(|err| {
                        error!("Error fetching current user from db: {err:?}");
                        return StatusCode::INTERNAL_SERVER_ERROR;
                    })?;

                Ok::<_, StatusCode>(Json(json!({
                    "id": me.id,
                    "name": me.name,
                    "email": me.email,
                    "created": me.created,
                })))
            }),
        )
        .route(
            "/me",
            patch(|State(core): State<Core>, cookies: Cookies, Json(req): Json<UpdateUserRequest>| async move {
                let token = Token::from_cookies(&core, &cookies).ok_or(StatusCode::UNAUTHORIZED)?;

                sqlx::query!(
                       r#"
                       UPDATE account
                       SET
                           name = COALESCE(?, name),
                           email = COALESCE(?, email),
                           password = COALESCE(?, password)
                       WHERE id = ?
                       "#,
                       req.name,
                       req.email,
                       req.password
                            .as_ref()
                            .map(|password| {
                                 Argon2::default()
                                      .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
                                      .map(|hash| hash.to_string())
                                      .map_err(|err| {
                                        error!("Error hashing user password: {err:?}");
                                        StatusCode::INTERNAL_SERVER_ERROR
                                      })
                            })
                            .transpose()?,
                       token.account_id(),
                   )
                   .fetch_optional(&core.db)
                   .await
                    .map_err(|err| {
                        if let sqlx::Error::Database(err) = &err {
                            if err.kind() == ErrorKind::UniqueViolation {
                                return StatusCode::CONFLICT;
                            }
                        }

                        error!("Error updating user in db: {err:?}");
                        return StatusCode::INTERNAL_SERVER_ERROR;
                    })?;

                Ok::<_, StatusCode>(StatusCode::NO_CONTENT)
            }),
        )
        .route(
            "/me",
            delete(|State(core): State<Core>| async move {
                // TODO: Implement it!
                StatusCode::SERVICE_UNAVAILABLE
            }),
        )
}
