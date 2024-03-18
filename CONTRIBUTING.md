# Contributing

> [!WARNING]  
> We are focused on developing the core platform at the moment so the developer onboarding experience is very rough. Feel free to reach out in the Discord if your having problems.

To contribute you will require:
 - A MySQL database
 - Azure app registration - used for the Entra ID identity provider
 - AWS credentials - used for [SES]()

And have the following software installed:
 - [Rust](https://www.rust-lang.org)
 - [pnpm](https://pnpm.io)
 - [Node.js](https://nodejs.org)
 - (for some internal tooling) [Bun](https://bun.sh)

```bash
# API & Web UI
pnpm i
cp .env.example .env
pnpm dev
# pnpm db:push
# pnpm db:studio

# MDM backend
cargo run -p mattrax -- init
cargo run -p mattrax -- serve

# Configure
pnpm configure tauri dev
```