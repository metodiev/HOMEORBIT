import { getDb } from "@/lib/db";
import { runProactiveChecks } from "@/lib/proactive/insights";

getDb();
const results = runProactiveChecks();
for (const result of results) {
  console.log(
    `Household ${result.householdId}: ${result.insights} insights, ${result.notificationsCreated} notifications, ${result.remindersSent} reminders, ${result.eventRemindersSent} event reminders.`,
  );
}
