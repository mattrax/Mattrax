//! WARNING: This is only designed for development purposes and does not support the full capabilities of Mattrax Cloud!

use std::net::Ipv4Addr;

#[tokio::main]
async fn main() {
    let app = mx_cloud::Context::from_env()
        .expect("Failed to load context")
        .mount();

    let listener = tokio::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, 3000))
        .await
        .unwrap();
    axum::serve(listener, app).await.unwrap();
}
