import { getCurrentActor } from "@/lib/auth/session";
import { exportAccountData } from "@/lib/domain/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getCurrentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const data = exportAccountData(actor);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="homeorbit-account-export.json"`,
      "cache-control": "no-store",
    },
  });
}
