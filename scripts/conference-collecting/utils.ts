import type { CollectedConference } from "./schema.js";

/**
 * Introduces a random delay between min and max milliseconds.
 * Used for rate-limiting requests to external servers.
 */
export async function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.random() * (maxMs - minMs) + minMs;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Resolves a relative or absolute URL against a base URL.
 * Returns undefined if URL is invalid or empty.
 */
export function resolveUrl(
  url: string | undefined,
  baseUrl: string,
): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return undefined;
  }
}

/**
 * Formats a date as ISO 8601 string (YYYY-MM-DD).
 * Handles month names (e.g., "November", "Nov") and converts to numeric format.
 */
export function formatDateISO(
  month: string,
  day: string,
  year: number,
): string {
  const months: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    sept: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };

  const monthNumber = months[month.toLowerCase()] ?? "01";

  return `${year}-${monthNumber}-${day.padStart(2, "0")}`;
}

/**
 * Parses various date string formats (single date, date range, year-only).
 * Returns startDate, endDate (if available), and year.
 */
export function parseDateRange(dateStr: string): {
  startDate?: string;
  endDate?: string;
  year?: number;
} {
  if (!dateStr) {
    return {};
  }

  const years = dateStr.match(/\b(19\d{2}|20\d{2})\b/g);
  const year = years?.length
    ? Number.parseInt(years[years.length - 1], 10)
    : undefined;

  const rangeMatch = dateStr.match(
    /(\w+)\s+(\d{1,2}),?\s+(\d{4})\s*-\s*(\w+)?\s*(\d{1,2}),?\s*(\d{4})?/,
  );

  if (rangeMatch) {
    const [, month1, day1, year1, month2, day2, year2] = rangeMatch;

    const startYear = Number.parseInt(year1, 10);
    const endYear = year2 ? Number.parseInt(year2, 10) : startYear;

    return {
      startDate: formatDateISO(month1, day1, startYear),
      ...(day2 && {
        endDate: formatDateISO(month2 || month1, day2, endYear),
      }),
      year,
    };
  }

  const singleMatch = dateStr.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);

  if (singleMatch) {
    const [, month, day, parsedYear] = singleMatch;

    return {
      startDate: formatDateISO(month, day, Number.parseInt(parsedYear, 10)),
      year: Number.parseInt(parsedYear, 10),
    };
  }

  return { year };
}


/**
 * Extracts acronym from conference title using pattern matching.
 * Returns undefined if no valid acronym found.
 */
export function extractConferenceAcronym(title: string): string | undefined {
  const cleaned = title.replace(/^\d{4}\s+/, "").trim();
  const match = cleaned.match(/^([A-Z][A-Z0-9]{1,})(?:\b|[-_])/);

  if (!match) {
    return undefined;
  }

  const acronym = match[1].replace(/\d{4}$/, "").trim();

  return acronym.length >= 2 ? acronym : undefined;
}

export const generateCollectionDate = (): string => {
  return new Date().toISOString().slice(0, 10);
}

// This is a list of categories that we do not want to collect from WikiCFP.
// This can help the collector action nut run over the 6hr limit.
export const wikiCFPCategoriesToNotCollect = [
  "1",
  "anthropology",
  "art",
  "arts",
  "business",
  "business intelligence",
  "business management",
  "communication",
  "communications",
  "culture",
  "cultural studies",
  "design",
  "e-business",
  "e-commerce",
  "e-education",
  "e-learning",
  "ECONOMIC",
  "economics",
  "education",
  "entrepreneurship",
  "ethics",
  "film",
  "finance",
  "higher education",
  "history",
  "humanities",
  "international relations",
  "knowledge management",
  "language",
  "law",
  "leadership",
  "literature",
  "logistics",
  "management",
  "marketing",
  "media",
  "mobile",
  "multimedia",
  "music",
  "pedagogy",
  "philosophy",
  "political science",
  "politics",
  "popular culture",
  "psychology",
  "religion",
  "smart cities",
  "social",
  "social media",
  "social networks",
  "social science",
  "social sciences",
  "society",
  "sociology",
  "teaching",
  "tourism",
  "training"
];