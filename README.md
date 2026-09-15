<div align="center">

<br />

<h1>Conference Aggregator</h1>

<p>
A small TypeScript toolset to collect and aggregate conference CFP/posting metadata from public sources (WikiCFP, EasyChair, cfp.wiki).
</p>

<br />

</div>

---

## About

This repository contains a lightweight conference aggregator that crawls public conference listing sites and saves a deduplicated JSON database of conference postings at the repository root (`conference-postings.json`). It is intended for research and tooling that needs a machine-readable list of upcoming conferences and their CFP details.

The collector currently implements scrapers for three sources:

- `wikicfp` (WikiCFP)
- `easychair` (EasyChair CFP search)
- `cfpwiki` (cfp.wiki)

Extracted fields include conference name, year, dates, location, website URL, CFP text snippets, categories/tags, and source metadata. Records are deduplicated and merged on save.

## What this repo does

- Crawls listing and detail pages on WikiCFP, EasyChair, and cfp.wiki.
- Parses conference metadata and normalizes dates and acronyms.
- Merges new postings into a single JSON database at `conference-postings.json`.
- Provides single-site and full-collection CLI commands.

## How collection works

Running a collection script executes `scripts/conference-collecting/main.ts` with a `--site` argument (`all`, `wikicfp`, `easychair`, `cfpwiki`).

1. Crawl listings and collect detail-page URLs.
2. Fetch detail pages and parse conference metadata.
3. Merge/deduplicate postings and write the consolidated DB.

## Code layout

- `scripts/conference-collecting/main.ts`: CLI entrypoint (`--site`)
- `scripts/conference-collecting/collectors.ts`: source-specific scrapers
- `scripts/conference-collecting/schema.ts`: record/DB shapes
- `scripts/conference-collecting/storage.ts`: load/save `conference-postings.json`

## Where data is stored

- `conference-postings.json` (repo root): consolidated, deduplicated output.
- `storage/` (repo root): Crawlee internal crawl state (KV stores + request queues). Deleting it resets crawl progress/state.

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

- Collect only cfp.wiki:

```bash
pnpm run collect:cfpwiki
```

The collectors write the consolidated database to `conference-postings.json` at the repository root.

## Development

- Scraper logic lives in [scripts/conference-collecting/collectors.ts](scripts/conference-collecting/collectors.ts#L1).
- Record/DB shapes are defined in [scripts/conference-collecting/schema.ts](scripts/conference-collecting/schema.ts#L1).
- Load/save helpers are in [scripts/conference-collecting/storage.ts](scripts/conference-collecting/storage.ts#L1).

After changes, run `pnpm run collect:*` to update `conference-postings.json` (the project uses `tsx`, so no separate build step is required).

## File of interest

- `conference-postings.json` — consolidated output created/updated by the collectors.

## Contributing

Contributions welcome — open issues or pull requests for new collector sources, bug fixes, or improvements to normalization/merging logic.

## License

This repository does not include a top-level license file in this project snapshot. Add an appropriate license file if you intend to redistribute.
