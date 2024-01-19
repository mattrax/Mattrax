import { newApp } from "../utils";
import { app as authRouter } from "./auth";

export const mountRoutes = () => newApp().route("/auth", authRouter);
