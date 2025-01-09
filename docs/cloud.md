# Mattrax Cloud

Internal documentation for the setup of `cloud.mattrax.app`.

```bash
source .env.production && sqlx migrate run --source crates/mx-api/migrations --database-url $DATABASE_URL
cargo lambda build --release --arm64 && cargo lambda deploy mattrax --binary-name mattraxl
# TODO: Manually trigger CRON during first deployment?
```

## Infrastructure

TODO: Diagram
