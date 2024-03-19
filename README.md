<p align="center">
  <p align="center">
   <img width="150" height="150" src="apps/landing/src/assets/logo-rounded.png" alt="Mattrax Logo">
  </p>
	<p align="center">
    Mattrax MDM is a full device management solution <br /> for Windows, macOS, iOS, Android and Linux!
    <br />
    <a href="https://mattrax.app"><strong>mattrax.app »</strong></a>
    <br />
    <br />
    <a href="https://discord.gg/WPBHmDSfAn">Discord</a>
    ·
    <a href="https://mattrax.app">Website</a>
     ·
    <a href="https://docs.mattrax.app">Docs</a>
    ·
    <a href="https://twitter.com/mattraxapp">Twitter</a>
  </p>
</p>

> [!WARNING]  
> The repository is under heavy development and parts of it are not ready for public use.

## Overview

This repository is a monorepo of all Mattrax projects.

The components are:
 - [`apps/web`](apps/web) - [Solid frontend & tRPC API](https://cloud.mattrax.app)
 - [`apps/mattrax`](apps/mattrax) - MDM backend
 - [`apps/mattraxd`](apps/mattraxd) - Agent for managed devices that makes script execution and more 
 - [`apps/landing`](apps/landing) - [Landing website](https://mattrax.app)
 - [`apps/docs`](apps/docs) - [Documentation website](https://docs.mattrax.app)
 - [`apps/configure`](apps/configure) - Cross-platform MDM policy builder

We mainly use the following technologies:
 - [SolidJS](https://www.solidjs.com)
 - [TailwindCSS](https://tailwindcss.com)
 - [tRPC](https://trpc.io)
 - [DrizzleORM](https://orm.drizzle.team)
 - [Kobalte](https://kobalte.dev)
 - [SolidUI](https://www.solid-ui.com)

## Contributing

Check out the guide in [`CONTRIBUTING.md`](CONTRIBUTING.md).
