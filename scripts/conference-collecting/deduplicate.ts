import {
  type DedupMergeField,
  type DedupSourceId,
  getDedupSourceRank,
} from "./collection-config.js";
import type { CollectedConference } from "./schema.js";

const MERGE_FIELDS: DedupMergeField[] = [
  "conferenceName",
  "conferenceYear",
  "conferenceLocation",
  "conferenceUri",
  "conferenceStartDate",
  "conferenceEndDate",
  "conferenceAcronym",
  "conferenceSeries",
  "conferenceCategories",
  "conferenceText",
  "submissionDeadline",
];

function normalizeDedupKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function postingRankForField(
  posting: CollectedConference,
  field: DedupMergeField,
): number {
  const sources = posting._source ?? [];
  let best = 0;

  for (const source of sources) {
    best = Math.max(best, getDedupSourceRank(field, source as DedupSourceId));
  }

  return best;
}

function isFieldEmpty(field: DedupMergeField, value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return !value.trim();
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
}

function filledFieldCount(posting: CollectedConference): number {
  let count = 0;

  for (const field of MERGE_FIELDS) {
    if (!isFieldEmpty(field, posting[field])) {
      count++;
    }
  }

  return count;
}

function comparePostingPriority(
  a: CollectedConference,
  b: CollectedConference,
  field: DedupMergeField,
): number {
  const byRank = postingRankForField(b, field) - postingRankForField(a, field);
  if (byRank !== 0) {
    return byRank;
  }

  const byFilledFields = filledFieldCount(b) - filledFieldCount(a);
  if (byFilledFields !== 0) {
    return byFilledFields;
  }

  return a.id.localeCompare(b.id);
}

function sortByFieldPriority(
  group: CollectedConference[],
  field: DedupMergeField,
): CollectedConference[] {
  return [...group].sort((a, b) => comparePostingPriority(a, b, field));
}

function pickScalarField(
  group: CollectedConference[],
  field: DedupMergeField,
): CollectedConference[DedupMergeField] {
  for (const posting of sortByFieldPriority(group, field)) {
    const value = posting[field];
    if (!isFieldEmpty(field, value)) {
      return value;
    }
  }

  return group[0]?.[field] ?? null;
}

function mergeCategories(group: CollectedConference[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const posting of sortByFieldPriority(group, "conferenceCategories")) {
    for (const category of posting.conferenceCategories ?? []) {
      const trimmed = category.replace(/\s+/g, " ").trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        merged.push(trimmed);
      }
    }
  }

  return merged;
}

function mergeSources(group: CollectedConference[]): string[] {
  return [...new Set(group.flatMap((posting) => posting._source ?? []))];
}

function pickNewestCollectionDate(group: CollectedConference[]): string | null {
  let newest: string | null = null;

  for (const posting of group) {
    const date = posting.collectionDate;
    if (!date) {
      continue;
    }

    if (!newest || date > newest) {
      newest = date;
    }
  }

  return newest;
}

function mergeDuplicateGroup(group: CollectedConference[]): CollectedConference {
  if (group.length === 1) {
    return group[0];
  }

  const primary = sortByFieldPriority(group, "conferenceName")[0];

  const merged = {
    id: primary.id,
    collectionDate: pickNewestCollectionDate(group),
    _source: mergeSources(group),
    conferenceIdentifier: primary.conferenceIdentifier,
    conferenceIdentifierType: primary.conferenceIdentifierType,
    conferenceSchemaUri: primary.conferenceSchemaUri,
  } as CollectedConference;

  for (const field of MERGE_FIELDS) {
    if (field === "conferenceCategories") {
      merged.conferenceCategories = mergeCategories(group);
      continue;
    }

    merged[field] = pickScalarField(group, field) as never;
  }

  return merged;
}

function deduplicateByField(
  postings: CollectedConference[],
  rawKey: (posting: CollectedConference) => string | null | undefined,
  missingKeyPrefix: string,
): CollectedConference[] {
  const groups = new Map<string, CollectedConference[]>();

  for (const posting of postings) {
    const raw = rawKey(posting);
    const normalized =
      typeof raw === "string" ? normalizeDedupKey(raw) : "";

    if (!normalized) {
      groups.set(`${missingKeyPrefix}:${posting.id}`, [posting]);
      continue;
    }

    const group = groups.get(normalized);
    if (group) {
      group.push(posting);
    } else {
      groups.set(normalized, [posting]);
    }
  }

  return [...groups.values()].map(mergeDuplicateGroup);
}

/** Merge duplicates by normalized conference name (per-field source priority). */
export function deduplicatePostings(
  postings: CollectedConference[],
): CollectedConference[] {
  return deduplicateByField(
    postings,
    (posting) => posting.conferenceName,
    "__missing_name__",
  );
}
