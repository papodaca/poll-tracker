# Gather 2026 polls

Instructions for an agent adding polls to this repo. The site only stores what you file. It does not average polls or decide who is ahead.

## Work queue

[docs/races-2026.json](races-2026.json) lists every November 3, 2026 contest the site already generates.

- 35 Senate races. Florida and Ohio are special elections. Their ids end in `senate-special`.
- 36 governor races.
- 435 House races. Six states use `at-large` instead of a district number: Alaska, Delaware, North Dakota, South Dakota, Vermont, Wyoming.

Work Senate, then governor, then House. The file is already in that order. Do not add or remove rows.

`lastUpdated` is null until that race is saved. When it is saved, set `lastUpdated` to the current UTC time, such as `2026-09-28T23:05:00Z`.

List the races that still need a pass. That is every row whose `lastUpdated` is null or older than 23 hours:

```sh
jq '[.[] | select(
  .lastUpdated == null
  or (.lastUpdated | fromdateiso8601) < (now - 23 * 3600)
)]' docs/races-2026.json
```

One manager keeps five gatherers working. The manager does not search or write poll files. The manager assigns race ids and writes `lastUpdated`.

Each gatherer gets the next 20 open races that no running gatherer already has. Open means the filter above, in file order. If fewer than 20 are left, assign those.

A gatherer writes the candidate and poll files for its races. It does not edit `docs/races-2026.json`. It runs `npm run check` and fixes only files it added. It reports one line per race id, either the poll ids it wrote or `no public poll`. A race with no public poll is finished. Say a race could not be finished only when a page that might hold the toplines did not open.

When a gatherer returns, the manager sets `lastUpdated` on every race that gatherer finished, including races with no public poll. Use one current UTC timestamp for that batch. Leave `lastUpdated` null when the gatherer could not finish it. That id stays at the top of the filter for the next assignment.

Then the manager starts one new gatherer with the next unassigned open races, so five stay running. Do not start a gatherer when every remaining open id is already assigned.

Stop when the filter returns `[]`. Do not commit unless asked.

Regenerate the list after a roster change. Existing `lastUpdated` timestamps stay put.

```sh
node scripts/list-races.ts
```

A House special, or any contest missing from that file, is an extra race. Add `src/data/extra-races/<id>.json` using the shape in the README, then gather polls for that id the same way.

## What to record

Record a general-election horse-race poll for that office, state, and district. The question names candidates in that contest, and the fieldwork falls in the 2026 cycle. Polls fielded in 2025 count when they test that same general election.

Leave these out:

- Primary polls, runoff polls, and jungle-primary questions that are not the November ballot
- Favorability, approval, and issue questions
- Generic ballot and presidential trial heats
- A poll for a different district, a different office, or a different state
- Numbers you could not open on a public page

If a source prints both a likely-voter table and a registered-voter table for the same question and the same field dates, file the likely-voter table only. If it prints only registered voters, file that table and set `population` to the label it uses.

If a source prints a head-to-head and a fuller field for the same dates, file the question that matches the November ballot. Skip the other question. The poll file has no field for the question wording, so two files from the same release would look like two different polls.

Include partisan and internal polls. Put the sponsor in `sponsor`.

Many House races have no public poll. Add no files and move to the next race.

## How to search

Start with the `search` string on that race. Open the pollster's release or the news story that prints the toplines. Aggregator tables are a way to find the poll. Copy the figures from the release or from the article that prints them. When those two disagree, use the release.

Use pages that open without an account. If the only copy of a number is behind a login, skip that poll.

Before writing, look through `src/data/polls/` for the same `raceId`, pollster, and `endDate`. If that poll is already filed, skip it.

## Files to add

Add a candidate file before any poll that cites that person. Reuse the candidate file when the same person already has one for this `raceId`.

`src/data/candidates/<id>.json`

```json
{
  "id": "ga-senate-jordan-blake",
  "raceId": "2026-ga-senate-class-2",
  "name": "Jordan Blake",
  "party": "Republican",
  "portrait": null
}
```

`src/data/polls/<id>.json`

```json
{
  "id": "harbor-survey-2026-09-21-ga-senate-class-2",
  "raceId": "2026-ga-senate-class-2",
  "pollster": "Harbor Survey",
  "sponsor": "Example Desk",
  "startDate": "2026-09-18",
  "endDate": "2026-09-21",
  "sampleSize": 900,
  "population": "LV",
  "marginOfError": 3.2,
  "url": "https://example.com/ga-senate-poll",
  "sample": false,
  "results": [
    { "candidateId": "ga-senate-alex-morgan", "percent": 47 },
    { "candidateId": "ga-senate-jordan-blake", "percent": 46 }
  ]
}
```

Set `sample` to `false` for a real poll. Omit `sponsor`, `sampleSize`, `population`, `marginOfError`, or `url` when the source does not give them. Do not invent a value to fill a gap.

## Field rules

`id` matches `^[a-z0-9-]+$`. Candidate ids start with the state and office, then a slug of the name, so two races can share a person's name. Poll ids start with the pollster slug, then the end date, then the race id without the `2026-` prefix.

`party` is the word the source uses, such as Democratic, Republican, Libertarian, or independent.

`portrait` stays `null` unless you have an image file you are allowed to store. The path then looks like `portraits/<id>.jpg` and the file lives under `public/`. A missing file fails the check.

`startDate` and `endDate` are the field dates, in `YYYY-MM-DD`. Use the release date only when the source gives no field dates, and use that single date for both fields. A published range such as September 18-21, 2026 becomes `2026-09-18` and `2026-09-21`.

`population` is the source's own label. Copy `LV`, `RV`, or `A`. Do not translate it.

`marginOfError` is the published number without a plus or minus sign.

`url` is a public page that shows these toplines.

`results` follow the source table from top to bottom. Copy each percent as printed, including decimals. The total does not have to reach 100. Include each named candidate the table lists. Omit undecided, other, and refused. Do not allocate those shares onto the candidates.

The district in a House poll has to match `district` on the race. Pennsylvania 7 is not Pennsylvania 17. An at-large state uses `house-at-large`, not district 1.
