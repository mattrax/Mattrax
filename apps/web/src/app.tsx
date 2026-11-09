import { Head, Title } from "@solidjs/meta";
import { createRouter } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { isServer } from "@solidjs/web";
import { Loading } from "solid-js";
import { pageRoutes } from "virtual:file-routes";
import "./app.css";

// Data lives behind the API Worker's auth and only the browser has the session
// it expects. Keeping queries idle during SSR avoids holding the document open
// (and serializing transport errors) while the client fetches after hydration.
const queryClient = new QueryClient({
  defaultOptions: { queries: { enabled: !isServer } },
});

const Router = createRouter({ routes: fileRoutes(pageRoutes) });

export default function App() {
  return (
    <Router>
      {(props) => (
        <Head>
          <Title>Mattrax</Title>
          <QueryClientProvider client={queryClient}>
            <Loading fallback="Loading...">{props.children}</Loading>
          </QueryClientProvider>
        </Head>
      )}
    </Router>
  );
}
