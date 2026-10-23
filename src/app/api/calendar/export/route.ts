import { getCurrentActor } from "@/lib/auth/session";
import { exportIcs } from "@/lib/domain/ics";
import { addDaysToDateString, dateStringInZone } from "@/lib/util/dates";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getCurrentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const today = dateStringInZone(new Date(), actor.timezone);
  const fromDate = url.searchParams.get("from") ?? today;
  const toDate = url.searchParams.get("to") ?? addDaysToDateString(fromDate, 60);
  const calendarIds = url.searchParams.getAll("calendarId");
  try {
    const ics = exportIcs(
      actor,
      `${fromDate}T00:00:00.000Z`,
      `${toDate}T23:59:59.999Z`,
      calendarIds.length > 0 ? calendarIds : undefined,
    );
    return new Response(ics, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="homeorbit-${fromDate}.ics"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Export failed.", { status: 400 });
  }
}
