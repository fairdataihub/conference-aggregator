/** Valid `_sources` tags on collected postings and CLI `--site` ids. */
export const POSTING_SOURCES = [
  "cfp.wiki",
  "callforpaper.org",
  "call4paper.com",
  "wikidata.org",
  "wiki.cfp",
] as const;

export type PostingSourceId = (typeof POSTING_SOURCES)[number];

/**
 * Represents a collected conference record with metadata extracted from various sources.
 * All date fields are ISO 8601 format (YYYY-MM-DD).
 */
export interface CollectedConference {
  id: string;
  conferenceName: string;
  conferenceYear: number | null;
  conferenceLocation?: string | null;
  conferenceUri?: string | null;
  conferenceIdentifier?: string;
  conferenceIdentifierType?: string;
  conferenceSchemaUri?: string;
  conferenceStartDate?: string | null;
  conferenceEndDate?: string | null;
  conferenceAcronym?: string | null;
  conferenceSeries?: string | null;
  /** Data sources that contributed to this record (more than one after dedup). */
  _sources?: string[];
  collectionDate?: string | null;
  conferenceCategories?: string[] | null;
  conferenceText?: string | null;
  submissionDeadline?: string | null;
}

/**
 * Represents the complete conference database with metadata and postings.
 */
export interface ConferenceDatabase {
  metadata: {
    /** Timestamp of last update */
    lastUpdated: string;
    /** Total number of conference records */
    totalPostings: number;
    /** List of data sources included in this database */
    sources: string[];
  };
  /** Array of conference records */
  postings: CollectedConference[];
}
