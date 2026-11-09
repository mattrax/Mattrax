import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { ShieldCheck } from "~/components/ui/icons";

export default function IdentitySettingsPage() {
  return (
    <div class="grid gap-6 xl:grid-cols-2">
      <Card class="xl:col-span-2">
        <CardHeader>
          <CardTitle>Single sign-on</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex items-start gap-3">
            <span class="rounded-lg bg-stone-100 p-2 text-stone-600">
              <ShieldCheck class="size-5" />
            </span>
            <div>
              <p class="flex items-center gap-2 text-sm font-medium">
                SAML and OpenID Connect
                <Badge variant="secondary">Coming soon</Badge>
              </p>
              <p class="mt-1 text-sm text-muted-foreground">
                Connect your identity provider to control who can sign in and automatically
                provision administrators with SCIM.
              </p>
            </div>
          </div>
          <div class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Until SSO ships, invite administrators from the Administrators tab. Azure OIDC
            verification is already implemented in the platform and will be enabled here.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
