import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ConferenceDatabase } from "./schema.js";
import { collectUniqueSources } from "./utils.js";

/**
 * Creates an empty database with default metadata.
 */
export function createEmptyDatabase(): ConferenceDatabase {
  return {
    metadata: {
      lastUpdated: new Date().toISOString(),
      totalPostings: 0,
      sources: [],
    },
    postings: [],
  };
}

/**
 * Loads database from file, returns empty database if file doesn't exist.
 */
export async function loadConferenceDatabase(
  filePath: string,
): Promise<ConferenceDatabase> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content) as Partial<ConferenceDatabase>;

    return {
      metadata: parsed.metadata ?? createEmptyDatabase().metadata,
      postings: Array.isArray(parsed.postings) ? parsed.postings : [],
    };
  } catch {
    return createEmptyDatabase();
  }
}

/**
 * Saves database to file with updated metadata.
 */
export async function saveConferenceDatabase(
  filePath: string,
  data: ConferenceDatabase,
): Promise<void> {
  const toWrite: ConferenceDatabase = {
    metadata: {
      lastUpdated: new Date().toISOString(),
      totalPostings: data.postings.length,
      sources: collectUniqueSources(data.postings),
    },
    postings: data.postings,
  };

  await fs.mkdir(path.dirname(filePath), {
    recursive: true,
  });

  await fs.writeFile(filePath, JSON.stringify(toWrite, null, 2), "utf-8");
}

function withoutConferenceText(data: ConferenceDatabase): ConferenceDatabase {
  return {
    metadata: data.metadata,
    postings: data.postings.map((posting) => ({
      ...posting,
      conferenceText: null,
    })),
  };
}

/** Writes full JSON and a slim copy with `conferenceText` set to null. */
export async function saveConferenceDatabaseExports(
  fullPath: string,
  slimPath: string,
  data: ConferenceDatabase,
): Promise<void> {
  await saveConferenceDatabase(fullPath, data);
  await saveConferenceDatabase(slimPath, withoutConferenceText(data));
}
