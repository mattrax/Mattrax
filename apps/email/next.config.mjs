import { configDotenv } from "dotenv";

if (process.env.NODE_ENV === "development")
  configDotenv({ path: "../../.env" });

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
