export default function Page() {
  if (import.meta.env.DEV)
    return <p class="p-4">Documentation is only available here in production builds!</p>;
  return null;
}
