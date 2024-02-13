import { configDotenv } from "dotenv";

if (process.env.NODE_ENV === "development")
  configDotenv({ path: "../../.env" });

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
