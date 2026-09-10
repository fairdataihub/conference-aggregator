import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { CollectedConference, ConferenceDatabase } from "./schema.js";

import { collectEasyChair, collectWikiCFP } from "./collectors.js";

import { loadConferenceDatabase, saveConferenceDatabase } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "conference-postings.json",
);

type Site = "all" | "wikicfp" | "easychair";

function parseSiteArg(): Site {
  // Supports:
  // - `--site all|wikicfp|easychair`
  // - `--site=<value>`
  const eqValue = process.argv.find((a) => a.startsWith("--site="))?.split("=", 2)[1];
  const spValue = process.argv.find((a) => a === "--site");
  const nextValue = spValue ? process.argv[process.argv.indexOf(spValue) + 1] : undefined;

  const rawSite = eqValue ?? nextValue ?? "";
  const normalized = rawSite.trim().toLowerCase();

  if (normalized === "wikicfp" || normalized === "easychair" || normalized === "all") {
    return normalized;
  }

  return "all";
}

function mergePostingsById(
  existing: CollectedConference[],
  updated: CollectedConference[],
): CollectedConference[] {
  const byId = new Map<string, CollectedConference>();

  for (const posting of existing) {
    byId.set(posting.id, posting);
  }

  // Updated postings should win in case of collisions.
  for (const posting of updated) {
    byId.set(posting.id, posting);
  }

  return [...byId.values()];
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const site = parseSiteArg();
  console.log(`[Main] Starting conference collection (site=${site})`);

  if (site === "all") {
    const collectors = [
      ["wikicfp", collectWikiCFP],
      ["easychair", collectEasyChair],
    ] as const;

    const collected: CollectedConference[] = [];

    for (const [name, collect] of collectors) {
      try {
        const postings = await collect();
        collected.push(...postings);
      } catch (error) {
        console.error(`[${name}] Collection failed:`, error);
      }
    }

    // Deterministic ordering helps keep diffs small between runs.
    collected.sort((a, b) => a.id.localeCompare(b.id));

    const db: ConferenceDatabase = {
      metadata: {
        lastUpdated: new Date().toISOString(),
        totalPostings: collected.length,
        sources: [
          ...new Set(
            collected
              .map((posting) => posting._source)
              .filter((source): source is string => Boolean(source)),
          ),
        ],
      },
      postings: collected,
    };

    await saveConferenceDatabase(DATABASE_PATH, db);
  } else {
    // Single-site update: keep other sources, replace only this site's postings.
    const existingDb = await loadConferenceDatabase(DATABASE_PATH);

    const collect = site === "wikicfp" ? collectWikiCFP : collectEasyChair;
    const updated = await collect();

    for (const posting of updated) {
      posting._source = site;
    }

    const existingOtherSources = existingDb.postings.filter(
      (p) => p._source !== site,
    );

    // Preserve other sources when ids collide (e.g. same conference found by both sites).
    // This keeps `--site wikicfp` from mutating existing `easychair` records.
    const byId = new Map<string, CollectedConference>(
      existingOtherSources.map((posting) => [posting.id, posting]),
    );

    for (const posting of updated) {
      if (!byId.has(posting.id)) {
        byId.set(posting.id, posting);
      }
    }

    const mergedPostings = [...byId.values()];
    mergedPostings.sort((a, b) => a.id.localeCompare(b.id));

    const db: ConferenceDatabase = {
      metadata: existingDb.metadata,
      postings: mergedPostings,
    };

    await saveConferenceDatabase(DATABASE_PATH, db);
  }

  const elapsedMs = Date.now() - startTime;
  const elapsedSec = (elapsedMs / 1000).toFixed(2);

  const finalDb = await loadConferenceDatabase(DATABASE_PATH);
  console.log(
    `[Main] Complete: ${finalDb.postings.length} conferences in database`,
  );
  console.log(`[Main] Duration: ${elapsedSec}s`);
  console.log(`[Main] Database: ${DATABASE_PATH}`);
}

main().catch((error) => {
  console.error("[Main] Fatal error:", error);
  process.exit(1);
});
