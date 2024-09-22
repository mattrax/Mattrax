//! This code is heavily copied from another project of [Cityscale](https://github.com/oscartbeaumont/cityscale).
//!
//! This is a `@planetscale/database` compatible adapter for usage with a regular MySQL database.
//! This provides connection pooling and an Edge compatible API with the ability for self-hosting.
//!
//! This implementation has also been stripped to just the stuff required by Mattrax. Eg. no `/CreateSession` endpoint because it's effectively unused in Planetscale's SDK.
//!

use std::{collections::HashMap, sync::Arc};

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use mysql_async::{
    consts::{ColumnFlags, ColumnType},
    prelude::*,
    Column, Row, Transaction, TxOpts, Value,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::RwLock;
use tracing::{debug, error};

use crate::Context;

pub struct ConnectionPool {
    /// Active database transactions
    sessions: RwLock<HashMap<String, Transaction<'static>>>,
}

pub fn mount() -> Router<Arc<Context>> {
    let pool = Arc::new(ConnectionPool {
        sessions: Default::default(),
    });

    Router::new()
            .route(
                "/Execute",
                post({
                    let pool = pool.clone();
                    |State(state): State<Arc<Context>>, Json(data): Json<SqlRequest>| async move {
                        let start = std::time::Instant::now();
                        let mut session = None;

                        if data.query == "BEGIN" {
                            let tx = state.db.start_transaction(TxOpts::default()).await.map_err(|err| {
                                error!("Error starting DB transaction: {err}");
                                error(format!("error starting DB transaction: {err:?}"))
                            })?;

                            let id = cuid2::create_id();
                            debug!("Creating new DB session {id:?}");

                            {
                                pool.sessions.write().await.insert(id.clone(), tx);
                            }

                            session = Some(TransactionSession {
                                id
                            });

                            // `BEGIN` is run by `db.start_transaction` so we don't actually wanna execute it
                            return Ok(Json(json!({
                                "session": session,
                                "result": json!({}),
                                "timing": start.elapsed().as_secs_f64(),
                            })).into_response());
                        }

                        let (columns, values, rows_affected, last_insert_id) = if let Some(session) = data.session {
                            // TODO: Can we only lock the specific session, not all of them while the DB query is running
                            let mut sessions = pool.sessions.write().await;

                            if data.query == "COMMIT" {
                                let tx = sessions.remove(&session.id).ok_or_else(|| {
                                    debug!("Attempted to commit non-existent transaction {:?}", session.id);
                                    error(format!("error committing non-existent transaction {:?}", session.id))
                                })?;

                                tx.commit().await.map_err(|err| {
                                    error!("Error committing transaction: {err}");
                                    error(format!("error committing transaction {:?}: {err:?}", session.id))
                                })?;
                                debug!("COMMIT transaction {:?}", session.id);

                                return Ok(Json(json!({
                                    "session": session,
                                    "result": json!({}),
                                    "timing": start.elapsed().as_secs_f64(),
                                })).into_response());
                            } else if data.query == "ROLLBACK" {
                                let tx = sessions.remove(&session.id).ok_or_else(|| {
                                    debug!("Attempted to rollback non-existent transaction {:?}", session.id);
                                    error(format!("error rolling back non-existent transaction {:?}", session.id))
                                })?;

                                tx.rollback().await.map_err(|err| {
                                    error!("Error rolling back transaction: {err}");
                                    error(format!("error rolling back transaction {:?}: {err:?}", session.id))
                                })?;
                                debug!("ROLLBACK transaction {:?}", session.id);

                                return Ok(Json(json!({
                                    "session": session,
                                    "result": json!({}),
                                    "timing": start.elapsed().as_secs_f64(),
                                })).into_response());
                            } else {
                                debug!("Executing query {:?} on session {:?}", data.query, session.id);
                                let tx = sessions.get_mut(&session.id).ok_or_else(|| {
                                    debug!("Attempted to getting non-existent transaction {:?}", session.id);
                                    error(format!("error getting non-existent transaction {:?}", session.id))
                                })?;

                                let result = tx
                                    .exec_iter(&data.query, ())
                                    .await
                                    .map_err(|err| {
                                        error!("Error executing query against transaction {:?}: {err}", session.id);
                                        error(format!("error executing query: {err:?}"))
                                    })?;

                                (result.columns(), result.collect_and_drop::<Row>().await, tx.affected_rows().to_string(), tx.last_insert_id().map(|v| v.to_string()))
                            }
                        } else {
                            let mut conn = state.db.get_conn().await.map_err(|err| {
                                error!("Error getting DB connection: {err}");
                                error(format!("error getting DB connection: {err:?}"))
                            })?;

                            debug!("Executing query {:?}", data.query);
                            let result =  conn
                                .exec_iter(&data.query, ())
                                .await
                                .map_err(|err| {
                                    error!("Error executing query: {err}");
                                    error(format!("error executing query: {err:?}"))
                                })?;

                            (result.columns(), result.collect_and_drop::<Row>().await, conn.affected_rows().to_string(), conn.last_insert_id().map(|v| v.to_string()))
                        };

                        let values = values.map_err(|err| {
                            error!("Error getting values: {err}");
                            error(format!("error decoding values: {err:?}"))
                        })?;

                        let fields = columns.as_deref()
                            .unwrap_or(&[])
                            .iter()
                            .map(|col|
                                json!({
                                    "name": col.name_str().to_string(),
                                    "type": column_type_to_str(col),
                                    "charset": col.character_set(),
                                    "flags": col.flags().bits()
                                })
                            )
                            .collect::<Vec<_>>();

                        let rows = values
                            .into_iter()
                            .map(|mut row| {
                                let mut lengths = Vec::new();
                                let mut values = Vec::new();

                                for i in 0..row.len() {
                                    let Some(value) = row.take(i) else {
                                        continue;
                                    };

                                    let result = match value {
                                        Value::NULL => {
                                            lengths.push(-1i64);
                                            continue;
                                        },
                                        Value::Bytes(v) => {
                                            lengths.push(v.len().try_into().expect("unable to cast usize to i64. How big are your damn pointers?"));
                                            values.extend(v);
                                            continue;
                                        },
                                        Value::Int(i) => i.to_string(),
                                        Value::UInt(i) => i.to_string(),
                                        Value::Float(i) => i.to_string(),
                                        Value::Double(i) => i.to_string(),
                                        // TODO: Planetscale seems to wipe out the fractional seconds, idk why but we are gonna copy for now.
                                        Value::Date(year, month, day, hour, minute, second, _) => {
                                            if row.columns_ref()[i].column_type() == ColumnType::MYSQL_TYPE_DATE {
                                                format!("{:04}-{:02}-{:02}", year, month, day)
                                            } else {
                                                format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", year, month, day, hour, minute, second)
                                            }
                                        },
                                        // TODO: Planetscale seems to wipe out the fractional seconds, idk why but we are gonna copy for now.
                                        Value::Time(neg, d, h, i, s, _) => {
                                            if neg {
                                                format!("-{:02}:{:02}:{:02}", d * 24 + u32::from(h), i, s)
                                            } else {
                                                format!("{:02}:{:02}:{:02}", d * 24 + u32::from(h), i, s)
                                            }
                                        }
                                    };

                                    lengths.push(result.len().try_into().expect("unable to cast usize to i64. How big are your damn pointers?"));
                                    values.extend(result.as_bytes());
                                }

                            json!({
                                "lengths": lengths,
                                "values": STANDARD.encode(values),
                            })
                        })
                        .collect::<Vec<_>>();

                        Ok::<Response, Response>(Json(json!({
                            "session": session,
                            "result": json!({
                                "rowsAffected": rows_affected,
                                "insertId": last_insert_id,
                                "fields": fields,
                                "rows": rows,
                            }),
                            "timing": start.elapsed().as_secs_f64(),
                        })).into_response())
                    }
                }),
            )
}

pub async fn auth(State(state): State<Arc<Context>>, request: Request, next: Next) -> Response {
    let authorization = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok());

    if authorization
        != Some(&format!(
            "Basic {}",
            STANDARD.encode(format!(":{}", &state.internal_secret))
        ))
        && authorization != Some(&format!("Bearer {}", state.internal_secret))
    {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    next.run(request).await
}

fn error(msg: String) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({
            "error": {
                "message": msg,
            }
        })),
    )
        .into_response()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct TransactionSession {
    id: String,
}

#[derive(Deserialize)]
struct SqlRequest {
    query: String,
    session: Option<TransactionSession>,
}

// Convert MySQL column types to Vitess column types
//
// Ref:
// - https://github.com/vitessio/vitess/blob/9e40015748ede158357bd7291f583db138abc3df/go/sqltypes/type.go#L142
// - https://vitess.io/files/version-pdfs/Vitess-Docs-6.0-04-29-2020.pdf
fn column_type_to_str(col: &Column) -> &'static str {
    let is_signed = !col.flags().contains(ColumnFlags::UNSIGNED_FLAG);
    let is_binary = col.flags().contains(ColumnFlags::BINARY_FLAG);

    if col.flags().contains(ColumnFlags::ENUM_FLAG) {
        return "ENUM";
    } else if col.flags().contains(ColumnFlags::SET_FLAG) {
        return "SET";
    }

    match col.column_type() {
        ColumnType::MYSQL_TYPE_DECIMAL => "DECIMAL",
        ColumnType::MYSQL_TYPE_TINY => t(is_signed, "INT8", "UINT8"),
        ColumnType::MYSQL_TYPE_SHORT => t(is_signed, "INT16", "UINT16"),
        ColumnType::MYSQL_TYPE_LONG => t(is_signed, "INT32", "UINT32"),
        ColumnType::MYSQL_TYPE_FLOAT => "FLOAT32",
        ColumnType::MYSQL_TYPE_DOUBLE => "FLOAT64",
        ColumnType::MYSQL_TYPE_NULL => "NULL",
        ColumnType::MYSQL_TYPE_TIMESTAMP => "TIMESTAMP",
        ColumnType::MYSQL_TYPE_LONGLONG => t(is_signed, "INT64", "UINT64"),
        ColumnType::MYSQL_TYPE_INT24 => t(is_signed, "INT24", "UINT24"),
        ColumnType::MYSQL_TYPE_DATE => "DATE",
        ColumnType::MYSQL_TYPE_TIME => "TIME",
        ColumnType::MYSQL_TYPE_DATETIME => "DATETIME",
        ColumnType::MYSQL_TYPE_YEAR => "YEAR",
        ColumnType::MYSQL_TYPE_NEWDATE => unreachable!("Internal to MySQL."),
        ColumnType::MYSQL_TYPE_VARCHAR => "VARCHAR",
        ColumnType::MYSQL_TYPE_BIT => "BIT",
        ColumnType::MYSQL_TYPE_TIMESTAMP2 => todo!(),
        ColumnType::MYSQL_TYPE_DATETIME2 => todo!(),
        ColumnType::MYSQL_TYPE_TIME2 => todo!(),
        ColumnType::MYSQL_TYPE_TYPED_ARRAY => unreachable!("Used for replication only."),
        ColumnType::MYSQL_TYPE_UNKNOWN => unreachable!(),
        ColumnType::MYSQL_TYPE_JSON => "JSON",
        ColumnType::MYSQL_TYPE_NEWDECIMAL => todo!(),
        ColumnType::MYSQL_TYPE_ENUM => "ENUM",
        ColumnType::MYSQL_TYPE_SET => "SET",
        ColumnType::MYSQL_TYPE_TINY_BLOB
        | ColumnType::MYSQL_TYPE_MEDIUM_BLOB
        | ColumnType::MYSQL_TYPE_LONG_BLOB
        | ColumnType::MYSQL_TYPE_BLOB => t(is_binary, "BLOB", "TEXT"),
        ColumnType::MYSQL_TYPE_VAR_STRING => t(is_binary, "VARBINARY", "VARCHAR"),
        ColumnType::MYSQL_TYPE_STRING => t(is_binary, "BINARY", "CHAR"),
        ColumnType::MYSQL_TYPE_GEOMETRY => "GEOMETRY",
    }
}

fn t<T>(a_or_b: bool, a: T, b: T) -> T {
    if a_or_b {
        a
    } else {
        b
    }
}
