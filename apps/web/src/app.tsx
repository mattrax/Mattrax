import { MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { Suspense } from "solid-js";
import "./app.css";

const queryClient = new QueryClient();

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <Title>Mattrax</Title>
          <QueryClientProvider client={queryClient}>
            <Suspense fallback="Loading...">{props.children}</Suspense>
          </QueryClientProvider>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
