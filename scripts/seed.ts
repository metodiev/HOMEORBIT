import { getDb } from "@/lib/db";
import { seedDemoData } from "@/lib/db/seed";

getDb();
const result = seedDemoData();
console.log(result.seeded ? `Seeded: ${result.summary}` : result.summary);
console.log(`Household id: ${result.householdId}`);
if (result.seeded) {
  console.log("");
  console.log("Demo sign-ins (password for all with an email): OrbitDemo123!");
  console.log("  ivan@homeorbit.demo   — administrator / parent");
  console.log("  maria@homeorbit.demo  — administrator / parent");
  console.log("  alex@homeorbit.demo   — teenager");
  console.log("  elena@homeorbit.demo  — invited relative");
  console.log("Mia, Sofia, Nikola and Lora have no accounts (managed by their guardians).");
}
