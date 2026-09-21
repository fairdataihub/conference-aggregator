import {
  type DedupMergeField,
  type DedupSourceId,
  getDedupFieldSourceOrder,
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

function normalizeConferenceName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

function postingPriorityForField(
  posting: CollectedConference,
  field: DedupMergeField,
): number {
  const order = getDedupFieldSourceOrder(field);
  const sources = posting._source ?? [];
  let best = order.length;

  for (const source of sources) {
    const index = order.indexOf(source as DedupSourceId);
    if (index !== -1 && index < best) {
      best = index;
    }
  }

  return best;
}

function sortByFieldPriority(
  group: CollectedConference[],
  field: DedupMergeField,
): CollectedConference[] {
  return [...group].sort(
    (a, b) => postingPriorityForField(a, field) - postingPriorityForField(b, field),
  );
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

/** Collapse postings that share the same normalized conference name. */
export function deduplicatePostings(
  postings: CollectedConference[],
): CollectedConference[] {
  const groups = new Map<string, CollectedConference[]>();

  for (const posting of postings) {
    const nameKey = normalizeConferenceName(posting.conferenceName);

    if (!nameKey) {
      groups.set(`__missing_name__:${posting.id}`, [posting]);
      continue;
    }

    const group = groups.get(nameKey);
    if (group) {
      group.push(posting);
    } else {
      groups.set(nameKey, [posting]);
    }
  }

  return [...groups.values()].map(mergeDuplicateGroup);
}
