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
  _source?: string;
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
