# Contributing

> [!WARNING]  
> We are focused on developing the core platform at the moment so the developer onboarding experience is very rough.
>
> Feel free to reach out in [the Discord](https://discord.gg/WPBHmDSfAn) if your having problems!

To contribute you will require:
 - A MySQL database
 - Azure app registration - used for the Entra ID identity provider
 - AWS credentials - used for [SES](https://aws.amazon.com/ses)

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

## Things to know:

### Unidirectional dataflow

All data follows the following order:
 - User or device -> API (Typescript) -> Rust -> DB
 - I *will not* flow backwards,
 - It may and probably will skip layers

### tRPC

`authedProcedure` vs `tenantProcedure` and when to pick each.

### Drizzle to RS

TODO: Explain why we have this