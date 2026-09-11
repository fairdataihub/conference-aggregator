<div align="center">

<br />

<h1>Conference Aggregator</h1>

<p>
A small TypeScript toolset to collect and aggregate conference CFP/posting metadata from public sources (WikiCFP, EasyChair).
</p>

<br />

</div>

---

## About

This repository contains a lightweight conference aggregator that crawls public conference listing sites and saves a deduplicated JSON database of conference postings at the repository root (`conference-postings.json`). It is intended for research and tooling that needs a machine-readable list of upcoming conferences and their CFP details.

The collector currently implements scrapers for two sources:

- `wikicfp` (WikiCFP)
- `easychair` (EasyChair CFP search)

Extracted fields include conference name, year, dates, location, website URL, CFP text snippets, categories/tags, and source metadata. Records are deduplicated and merged on save.

## What this repo does

- Crawls listing and detail pages on WikiCFP and EasyChair.
- Parses conference metadata and normalizes dates and acronyms.
- Merges new postings into a single JSON database at `conference-postings.json`.
- Provides single-site and full-collection CLI commands.

## How collection works

When you run a collection command, the main script crawls site listings, extracts detail-page URLs, fetches detail pages, parses relevant metadata, and writes a consolidated JSON database. The process is implemented in TypeScript using `crawlee`.

```mermaid
flowchart TD
  A[Run collector (scripts/conference-collecting/main.ts)] --> B{--site arg}
  B -->|all| C[Run all collectors]
  B -->|wikicfp| D[Run WikiCFP collector]
  B -->|easychair| E[Run EasyChair collector]
  C --> F[Fetch listings -> detail pages]
  D --> F
  E --> F
  F --> G[Parse metadata -> normalize dates/acronyms]
  G --> H[Merge + deduplicate postings]
  H --> I[Save to conference-postings.json]
```

Key implementation files:

- [scripts/conference-collecting/main.ts](scripts/conference-collecting/main.ts#L1)
- [scripts/conference-collecting/collectors.ts](scripts/conference-collecting/collectors.ts#L1)
- [scripts/conference-collecting/schema.ts](scripts/conference-collecting/schema.ts#L1)
- [scripts/conference-collecting/storage.ts](scripts/conference-collecting/storage.ts#L1)

## Tech stack

- Language: TypeScript
- Crawling/scraping: `crawlee`
- Runtime tooling: `tsx` (dev runtime for TypeScript)
- Data: JSON file (`conference-postings.json`)

## Getting started

Prerequisites:

- Node.js (recommended recent LTS)
- pnpm (recommended) or a compatible package manager

Install dependencies:

```bash
pnpm install
```

Run the collectors (examples):

- Collect all configured sources:

```bash
pnpm run collect:all
```

- Collect only WikiCFP:

```bash
pnpm run collect:wikicfp
```

- Collect only EasyChair:

```bash
pnpm run collect:easychair
```

The collectors write the consolidated database to `conference-postings.json` at the repository root.

## Development

- Collection logic lives in [scripts/conference-collecting/collectors.ts](scripts/conference-collecting/collectors.ts#L1).
- Shape of stored records is defined in [scripts/conference-collecting/schema.ts](scripts/conference-collecting/schema.ts#L1).
- Storage helpers are in [scripts/conference-collecting/storage.ts](scripts/conference-collecting/storage.ts#L1).

To iterate on the collectors, modify the code and run the appropriate `pnpm run collect:*` script. The project uses `tsx` so TypeScript files can be executed directly without a build step.

## File of interest

- `conference-postings.json` — consolidated output created/updated by the collectors.

## Contributing

Contributions welcome — open issues or pull requests for new collector sources, bug fixes, or improvements to normalization/merging logic.

## License

This repository does not include a top-level license file in this project snapshot. Add an appropriate license file if you intend to redistribute.
