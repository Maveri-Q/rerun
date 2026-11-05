import { appLogoFile } from "@rerun/shared/browser";

export const dynamic = "force-static";

export function GET() {
  return new Response(appLogoFile(), { headers: { "content-type": "image/svg+xml" } });
}
