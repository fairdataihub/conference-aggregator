import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { CollectedConference, ConferenceDatabase } from "./schema.js";

import { collectCfpWiki } from "./cfpwiki.js";
import { collectWikiCFP } from "./wikicfp.js";
import { collectWikiData } from "./wikidata.js";
import { collectCall4Paper } from "./call4paper.js";

import { deduplicatePostings } from "./deduplicate.js";
import { loadConferenceDatabase, saveConferenceDatabase } from "./storage.js";
import { collectUniqueSources, postingHasSource } from "./utils.js";

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
  cfpwiki: collectCfpWiki,
  wikidata: collectWikiData,
  call4paper: collectCall4Paper,
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

  if (normalized === "all" || !normalized) {
    return "all";
  }

  if (normalized in COLLECTORS) {
    return normalized as keyof typeof COLLECTORS;
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

    const beforeDedup = collected.length;
    const deduped = deduplicatePostings(collected);
    deduped.sort((a, b) => a.id.localeCompare(b.id));

    console.log(
      `[Main] Merge dedup by name: ${beforeDedup} → ${deduped.length} postings`,
    );

    const db: ConferenceDatabase = {
      metadata: {
        lastUpdated: new Date().toISOString(),
        totalPostings: deduped.length,
        sources: collectUniqueSources(deduped),
      },
      postings: deduped,
    };

    await saveConferenceDatabase(DATABASE_PATH, db);
  } else {
    // Single-site update: keep other sources, replace only this site's postings.
    const existingDb = await loadConferenceDatabase(DATABASE_PATH);
    const collect = COLLECTORS[site];
    const updated = await collect();

    for (const posting of updated) {
      posting._source = [site];
    }

    const existingOtherSources = existingDb.postings.filter(
      (posting) => !postingHasSource(posting, site),
    );

    const byId = new Map<string, CollectedConference>(
      existingOtherSources.map((posting) => [posting.id, posting]),
    );

    for (const posting of updated) {
      // Replace by `id` so updated postings win on collisions.
      byId.set(posting.id, posting);
    }

    const mergedPostings = deduplicatePostings([...byId.values()]);
    mergedPostings.sort((a, b) => a.id.localeCompare(b.id));

    console.log(
      `[Main] Merge dedup by name: ${byId.size} → ${mergedPostings.length} postings`,
    );

    const db: ConferenceDatabase = {
      metadata: {
        ...existingDb.metadata,
        lastUpdated: new Date().toISOString(),
        totalPostings: mergedPostings.length,
        sources: collectUniqueSources(mergedPostings),
      },
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

  for (const field of ["conferenceName", "conferenceAcronym"] as const) {
    const counts = new Map<string, number>();

    for (const posting of finalDb.postings) {
      const value = posting[field];
      if (typeof value !== "string" || !value.trim()) {
        continue;
      }

      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    let duplicateKeys = 0;
    for (const [value, count] of counts) {
      if (count > 1) {
        duplicateKeys++;
        console.log(`[Main] Duplicate ${field}: ${count}x ${value}`);
      }
    }

    if (duplicateKeys === 0) {
      console.log(`[Main] Duplicate ${field}: none`);
    }
  }
}

main().catch((error) => {
  console.error("[Main] Fatal error:", error);
  process.exit(1);
});
