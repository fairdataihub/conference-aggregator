import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { CollectedConference, ConferenceDatabase } from "./schema.js";

import { collectCfpWiki, collectEasyChair, collectWikiCFP } from "./collectors.js";

import { loadConferenceDatabase, saveConferenceDatabase } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "conference-postings.json",
);

const COLLECTORS = {
  wikicfp: collectWikiCFP,
  easychair: collectEasyChair,
  cfpwiki: collectCfpWiki,
};

type Site = "all" | keyof typeof COLLECTORS;

function parseSiteArg(): Site {
  // Supports:
  // - `--site all|wikicfp|easychair`
  // - `--site=<value>`
  const eqValue = process.argv
    .find((arg) => arg.startsWith("--site="))
    ?.split("=", 2)[1];

  const siteFlagIndex = process.argv.indexOf("--site");
  const nextValue =
    siteFlagIndex !== -1 ? process.argv[siteFlagIndex + 1] : undefined;

  const rawSite = eqValue ?? nextValue ?? "";
  const normalized = rawSite.trim().toLowerCase();

  if (normalized === "all") {
    return "all";
  }

  if (
    normalized === "wikicfp" ||
    normalized === "easychair" ||
    normalized === "cfpwiki"
  ) {
    return normalized;
  }

  return "all";
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const site = parseSiteArg();

  console.log(`[Main] Starting conference collection (site=${site})`);

  if (site === "all") {
    const collected: CollectedConference[] = [];

    for (const [name, collect] of Object.entries(COLLECTORS)) {
      try {
        const postings = await collect();
        collected.push(...postings);
      } catch (error) {
        console.error(`[${name}] Collection failed:`, error);
      }
    }

    collected.sort((a, b) => a.id.localeCompare(b.id));

    const db: ConferenceDatabase = {
      metadata: {
        lastUpdated: new Date().toISOString(),
        totalPostings: collected.length,
        sources: [
          ...new Set(
            collected
              .map((posting) => posting._source)
              .filter(
                (source): source is string => Boolean(source),
              ),
          ),
        ],
      },
      postings: collected,
    };

    await saveConferenceDatabase(DATABASE_PATH, db);
  } else {
    // Single-site update: keep other sources, replace only this site's postings.
    const existingDb = await loadConferenceDatabase(DATABASE_PATH);
    const collect = COLLECTORS[site];
    const updated = await collect();

    for (const posting of updated) {
      posting._source = site;
    }

    const existingOtherSources = existingDb.postings.filter(
      (posting) => posting._source !== site,
    );

    const byId = new Map<string, CollectedConference>(
      existingOtherSources.map((posting) => [posting.id, posting]),
    );

    for (const posting of updated) {
      // Replace by `id` so updated postings win on collisions.
      byId.set(posting.id, posting);
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