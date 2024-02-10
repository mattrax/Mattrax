use std::sync::Arc;

use axum::{
    http::StatusCode,
    response::Html,
    routing::{get, post},
    Router,
};

use super::Context;

// `/EnrollmentServer`
pub fn mount_enrollment(state: Arc<Context>) -> Router<Arc<Context>> {
    Router::new()
        .route("/TermsOfService.svc", get(|| async move {
            Html(r#"<h3>AzureAD Term Of Service</h3><button onClick="acceptBtn()">Accept</button><script>function acceptBtn(){var urlParams=new URLSearchParams(window.location.search);if (!urlParams.has('redirect_uri')){alert('Redirect url not found. Did you open this in your broswer?');}else{window.location=urlParams.get('redirect_uri') + "?IsAccepted=true&OpaqueBlob=TODOCustomDataFromAzureAD";}}</script>"#)
        }))
        // allows the device to tests a domain for the existence of a enrollment server
        .route("/Discovery.svc", get(|| async move {
            StatusCode::OK
        }))
        .route("/Discovery.svc", post(|| async move {
            todo!();
        }))
        .route("/Policy.svc", post(|| async move {
            todo!();
        }))
        .route("/Enrollment.svc", post(|| async move {
            todo!();
        }))
}

pub fn mount(state: Arc<Context>) -> Router<Arc<Context>> {
    Router::new().route(
        "/Manage.svc",
        post(|| async move {
            // TODO: Mutual TLS authentication

            todo!();
        }),
    )
    // .route("/manage", get(terms_of_service))
}
