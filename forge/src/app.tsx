import { Router } from "@solidjs/router";
import { Suspense } from "solid-js";
import { route } from "./app/index";

export default function App() {
  return (
    <Suspense>
      <Router>{route}</Router>
    </Suspense>
  );
}
