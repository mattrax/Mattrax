use std::{marker::PhantomData, ops::Deref};

use chrono::Utc;
use mx_db::{Db, GetSessionAndUserAccountResult, GetSessionAndUserSessionResult};
use rspc::{
    middleware::Middleware,
    procedure::{Procedure, ProcedureBuilder, ResolverInput, ResolverOutput},
};
use serde::Serialize;
use specta::Type;
use tracing::warn;

#[derive(Debug, thiserror::Error, Serialize, Type)]
pub enum Error {
    #[error("{0}")]
    Authentication(AuthenticationMiddlewareError),
}

impl rspc::Error for Error {
    fn status(&self) -> u16 {
        match self {
            Self::Authentication(err) => err.status(),
            _ => 500,
        }
    }
}

#[derive(Clone)]
pub struct Context {
    pub db: Db,
    pub session_id: Option<String>,
}

pub type Router = rspc::Router<Context>;

pub struct BaseProcedure<TErr = Error>(PhantomData<TErr>);

impl<TErr> BaseProcedure<TErr> {
    /// The base [`ProcedureBuilder`]. This procedure does not require authentication.
    pub fn builder<TInput, TResult>() -> ProcedureBuilder<TErr, Context, Context, TInput, TResult>
    where
        TErr: rspc::Error,
        TInput: ResolverInput,
        TResult: ResolverOutput<TErr>,
    {
        Procedure::builder()
    }

    /// A [`ProcedureBuilder`] that requires valid authentication.
    pub fn authenticated<TInput, TResult>(
    ) -> ProcedureBuilder<TErr, Context, AuthenticatedContext, TInput, TResult>
    where
        TErr: From<AuthenticationMiddlewareError> + rspc::Error,
        TInput: ResolverInput,
        TResult: ResolverOutput<TErr>,
    {
        Self::builder().with(authenticated())
    }
}

// TODO: Are these serialized as the value or `thiserror` cause maybe we want control over that???
#[derive(Debug, thiserror::Error, Serialize, Type)]
pub enum AuthenticationMiddlewareError {
    #[error("you must be unauthorised to access this endpoint")]
    Unauthorized,
    #[error("you are forbidden from accessing this endpoint")]
    Forbidden,
    #[error("error checking authentication")]
    InternalServerError,
}

impl rspc::Error for AuthenticationMiddlewareError {
    fn status(&self) -> u16 {
        match self {
            AuthenticationMiddlewareError::Unauthorized => 401,
            AuthenticationMiddlewareError::Forbidden => 403,
            AuthenticationMiddlewareError::InternalServerError => 500,
        }
    }
}

impl From<AuthenticationMiddlewareError> for Error {
    fn from(this: AuthenticationMiddlewareError) -> Self {
        Self::Authentication(this)
    }
}

pub struct AuthenticatedContext {
    pub account: GetSessionAndUserAccountResult,
    pub session: GetSessionAndUserSessionResult,
    pub ctx: Context,
}

impl Deref for AuthenticatedContext {
    type Target = Context;

    fn deref(&self) -> &Self::Target {
        &self.ctx
    }
}

pub fn authenticated<TErr, TInput, TResult>(
) -> Middleware<TErr, Context, TInput, TResult, AuthenticatedContext>
where
    TErr: From<AuthenticationMiddlewareError> + rspc::Error,
    TInput: Send + 'static,
    TResult: Send + 'static,
{
    // TODO: Replace with fully Rust authentication solution. This should use temporary short-lived tokens to reduce DB lookups.

    Middleware::new(move |ctx: Context, input: TInput, next| async move {
        let result = ctx
            .db
            .get_session_and_user(
                ctx.session_id
                    .clone()
                    .ok_or_else(|| AuthenticationMiddlewareError::Unauthorized)?,
            )
            .await
            .map_err(|err| {
                warn!("failed to get session and user from db: {err:?}");
                AuthenticationMiddlewareError::InternalServerError
            })?
            .into_iter()
            .next()
            .ok_or_else(|| AuthenticationMiddlewareError::Unauthorized)?;

        (result.session.expires_at > Utc::now().naive_utc())
            .then_some(())
            .ok_or(AuthenticationMiddlewareError::Unauthorized)?;

        next.exec(
            AuthenticatedContext {
                account: result.account,
                session: result.session,
                ctx,
            },
            input,
        )
        .await
    })
}
