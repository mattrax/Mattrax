export const route = [
  {
    path: "/",
    component: () => <h1>Hello World</h1>, // lazy(() => import("/pages/users.js")),
  },
  // TODO: 404 handler
];
