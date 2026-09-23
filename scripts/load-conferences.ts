import { readFile } from "node:fs/promises";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

import { PrismaClient } from "../shared/generated/client";
import type { Prisma } from "../shared/generated/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const inputFile = path.resolve(
  import.meta.dirname,
  "../conference-postings-full.json",
);

interface Posting {
  id: string;
  collectionDate: string;
  _sources: string[];
  conferenceName: string;
  conferenceYear: number | null;
  conferenceUri: string | null;
  conferenceLocation: string | null;
  conferenceStartDate: string | null;
  conferenceEndDate: string | null;
  conferenceAcronym: string | null;
  conferenceSeries: string | null;
  conferenceCategories: string[] | null;
  conferenceText: string | null;
  submissionDeadline: string | null;
}

// Dates come in as YYYY-MM-DD; anything else (e.g. "TBD") is stored as null
const toDate = (value: string | null) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value) : null;

const toConference = (
  posting: Posting,
): Prisma.ConferenceCreateManyInput => ({
  sourceUrl: posting.id,
  collectionDate: new Date(posting.collectionDate),
  sources: posting._sources,
  conferenceName: posting.conferenceName,
  conferenceYear: posting.conferenceYear,
  conferenceUri: posting.conferenceUri,
  conferenceLocation: posting.conferenceLocation,
  conferenceStartDate: toDate(posting.conferenceStartDate),
  conferenceEndDate: toDate(posting.conferenceEndDate),
  conferenceAcronym: posting.conferenceAcronym,
  conferenceSeries: posting.conferenceSeries,
  conferenceCategories: posting.conferenceCategories ?? [],
  conferenceText: posting.conferenceText,
  submissionDeadline: toDate(posting.submissionDeadline),
});

const loadConferences = async () => {
  // Configuration
  const insertBatchSize = 1000; // Number of records to insert per batch
  let totalProcessed = 0;
  let failed = 0;

  const { postings } = JSON.parse(await readFile(inputFile, "utf8")) as {
    postings: Posting[];
  };
  const totalCount = postings.length;

  console.log(
    `Loading ${totalCount.toLocaleString()} conferences from ${path.basename(inputFile)}`,
  );

  const startTime = Date.now();
  const barLength = 40;

  for (let i = 0; i < postings.length; i += insertBatchSize) {
    const batch = postings.slice(i, i + insertBatchSize);

    try {
      await prisma.conference.createMany({
        data: batch.map(toConference),
        skipDuplicates: true, // Skip if sourceUrl already exists
      });
    } catch (error) {
      failed += batch.length;
      console.error(`\nBatch at index ${i} failed:`, error);
      // Continue with next batch even if one fails
    }

    // Update progress
    totalProcessed += batch.length;
    const progress = (totalProcessed / totalCount) * 100;
    const filled = Math.round((progress / 100) * barLength);
    const empty = barLength - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = totalProcessed / (parseFloat(elapsed) || 1);
    const remaining = totalCount - totalProcessed;
    const eta = remaining / rate;

    process.stdout.write(
      `\r${bar} ${progress.toFixed(1)}% ${totalProcessed.toLocaleString()}/${totalCount.toLocaleString()} ${elapsed}s (ETA ${eta.toFixed(1)}s)`,
    );
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const inserted = await prisma.conference.count();
  console.log(
    `\nLoaded ${inserted.toLocaleString()} conferences in ${totalTime}s${failed ? ` (${failed.toLocaleString()} failed)` : ""}`,
  );
};

const main = async () => {
  // truncate the conference table
  await prisma.$executeRaw`TRUNCATE TABLE "Conference" RESTART IDENTITY CASCADE`;

  await loadConferences();
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
