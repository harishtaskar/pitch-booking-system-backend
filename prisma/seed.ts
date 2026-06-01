import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PITCHES = [
  { name: "Turf Ground", location: "North Wing", pricePerHour: 800 },
  { name: "Box Cricket", location: "Rooftop Arena", pricePerHour: 600 },
  { name: "Indoor Nets", location: "Basement Court", pricePerHour: 500 },
];

// Hourly slots from 06:00 to 22:00.
const START_HOUR = 6;
const END_HOUR = 22;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

async function main() {
  console.log("Seeding pitches and slots...");

  for (const p of PITCHES) {
    // Pitch name isn't unique in the schema, so find-or-create keeps the
    // seed idempotent across repeated runs.
    const existing = await prisma.pitch.findFirst({ where: { name: p.name } });
    const pitchId = existing
      ? existing.id
      : (await prisma.pitch.create({ data: p })).id;

    for (let h = START_HOUR; h < END_HOUR; h++) {
      const startTime = `${pad(h)}:00`;
      const endTime = `${pad(h + 1)}:00`;
      await prisma.slot.upsert({
        where: { pitchId_startTime: { pitchId, startTime } },
        update: { endTime },
        create: { pitchId, startTime, endTime },
      });
    }
    console.log(`  ✓ ${p.name}: ${END_HOUR - START_HOUR} slots`);
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
