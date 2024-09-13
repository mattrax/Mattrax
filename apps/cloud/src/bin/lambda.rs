#[tokio::main]
async fn main() -> Result<(), lambda_http::Error> {
    // If you use API Gateway stages, the Rust Runtime will include the stage name
    // as part of the path that your application receives. We don't want this!
    std::env::set_var("AWS_LAMBDA_HTTP_IGNORE_STAGE_IN_PATH", "true");

    let app = mx_cloud::Context::from_env()
        .expect("Failed to load context")
        .mount();

    lambda_http::run(app).await
}
