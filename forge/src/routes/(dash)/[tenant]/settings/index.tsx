// import { Label } from "@kobalte/core/dist/types/checkbox";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui";
import { DeleteTenantButton } from "./DeleteTenantButton";

export default function Page() {
  return (
    <div class="p-4">
      {/* TODO: Title */}

      <Card class="w-[350px]">
        <CardHeader>
          <CardTitle>Tenant Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <form>
            <div class="grid w-full items-center gap-4">
              <div class="flex flex-col space-y-1.5">
                {/* <Label for="name">Name</Label> */}
                <Input id="name" placeholder="Name of your project" />
              </div>
              <div class="flex flex-col space-y-1.5">
                {/* <Label for="framework">Framework</Label> */}
                {/* <Select>
                  <SelectTrigger id="framework">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="next">Next.js</SelectItem>
                    <SelectItem value="sveltekit">SvelteKit</SelectItem>
                    <SelectItem value="astro">Astro</SelectItem>
                    <SelectItem value="nuxt">Nuxt.js</SelectItem>
                  </SelectContent>
                </Select> */}
              </div>
            </div>
          </form>

          <DeleteTenantButton />
        </CardContent>
      </Card>
    </div>
  );
}

// TODO: Rename tenant

// TODO: Tenant user management
// TODO: Link with AzureAD
// TODO: Import devices from Intune/Jamf
