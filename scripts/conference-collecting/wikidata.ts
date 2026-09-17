import type { CollectedConference } from "./schema.js";
import { generateCollectionDate } from "./utils.js";
const WIKIDATA_CONFIG = { limit: 1000 as number | null };
export async function collectWikiData(): Promise<CollectedConference[]> {
  if (WIKIDATA_CONFIG.limit === null) {
    console.log("[Wikidata] Collection disabled: limit is null.");
    return [];
  }
  const conferences = new Map<string, CollectedConference>();
  const query = ` SELECT DISTINCT ?conference ?conferenceLabel ?description ?website ?startDate ?endDate ?location ?locationLabel ?acronym ?series ?seriesLabel ?subject ?subjectLabel WHERE { ?conference wdt:P31 wd:Q2020153 . ?conference rdfs:label ?conferenceLabel . FILTER(LANG(?conferenceLabel) = "en") OPTIONAL { ?conference schema:description ?description . FILTER(LANG(?description) = "en") } OPTIONAL { ?conference wdt:P856 ?website . } OPTIONAL { ?conference wdt:P580 ?startDate . } OPTIONAL { ?conference wdt:P582 ?endDate . } OPTIONAL { ?conference wdt:P276 ?location . } OPTIONAL { ?conference wdt:P1813 ?acronym . } OPTIONAL { ?conference wdt:P179 ?series . } OPTIONAL { ?conference wdt:P921 ?subject . } SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . } } LIMIT ${WIKIDATA_CONFIG.limit === null ? "" : WIKIDATA_CONFIG.limit} `;
  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  const response = await fetch(url, {
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent": "conference-aggregator/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Wikidata request failed: ${response.status} ${response.statusText}`,
    );
  }
  const data = await response.json();
  for (const result of data.results.bindings) {
    const id = result.conference.value;
    const subject = result.subjectLabel?.value || null;
    const existing = conferences.get(id);
    if (existing) {
      if (
        subject &&
        existing.conferenceCategories &&
        !existing.conferenceCategories.includes(subject)
      ) {
        existing.conferenceCategories.push(subject);
      }
      continue;
    }
    const conferenceStartDate = result.startDate?.value?.split("T")[0] || null;
    conferences.set(id, {
      id,
      collectionDate: generateCollectionDate(),
      _source: "wikidata",
      conferenceName: result.conferenceLabel?.value,
      conferenceYear: conferenceStartDate
        ? Number(conferenceStartDate.substring(0, 4))
        : null,
      conferenceUri: result.website?.value || null,
      conferenceLocation: result.locationLabel?.value || null,
      conferenceStartDate,
      conferenceEndDate: result.endDate?.value?.split("T")[0] || null,
      conferenceAcronym: result.acronym?.value || null,
      conferenceSeries: result.seriesLabel?.value || null,
      conferenceCategories: subject ? [subject] : [],
      conferenceText: result.description?.value || null,
      submissionDeadline: null,
    });
  }
  return [...conferences.values()];
}
