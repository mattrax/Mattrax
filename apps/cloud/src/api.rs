use std::sync::Arc;

use axum::Router;

use crate::Context;

// #[derive(Deserialize)]
// struct FeedbackRequest {
//     content: String,
// }

pub fn mount() -> Router<Arc<Context>> {
    //     let feedback_discord_webhook = std::env::var("FEEDBACK_DISCORD_WEBHOOK_URL");
    Router::new()
    // .route(
    //         "/api/feedback",
    //         post(|body: Json<FeedbackRequest>| async move {
    //             // TODO: Authentication

    //             if let Ok(url) = feedback_discord_webhook {
    //                 let body = body
    //                     .content
    //                     .split("\n")
    //                     .map(|l| format!("> {}", l))
    //                     .collect::<Vec<String>>();
    //                 // body.push(format!("`{}`", ctx.account.email)); // TODO

    //                 match client
    //                     .post(url)
    //                     .form(&[("content", body.join("\n"))])
    //                     .send()
    //                     .await
    //                 {
    //                     Ok(r) if !r.status().is_success() => {
    //                         error!(
    //                             "Error sending feedback to Discord: Got status {}",
    //                             r.status()
    //                         );
    //                         return (StatusCode::INTERNAL_SERVER_ERROR, "error");
    //                     }
    //                     Err(err) => {
    //                         error!("Error sending feedback to Discord: {err:?}");
    //                         return (StatusCode::INTERNAL_SERVER_ERROR, "error");
    //                     }
    //                     _ => {}
    //                 }
    //             } else {
    //                 return (StatusCode::CONFLICT, "disabled");
    //             }

    //             (StatusCode::OK, "ok")
    //         }),
    //     )
}
