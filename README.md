# 2026 polls

Static site of hand-entered polls for the 2026 general election. The pages list each poll. They do not average them or decide who is ahead.

## Commands

`npm run dev` starts the local site.

`npm run check` validates the JSON.

`npm run build` runs the check, then writes `dist/`.

## Add a candidate

Create `src/data/candidates/some-id.json`.

```json
{
  "id": "some-id",
  "raceId": "2026-pa-senate-class-2",
  "name": "Alex Morgan",
  "party": "Democratic",
  "portrait": "portraits/some-id.svg"
}
```

`portrait` is a file path under `public/`, or `null` when there is no image. The check fails if the path is set and the file is missing.

## Add a poll

Create `src/data/polls/some-poll.json`.

```json
{
  "id": "some-poll",
  "raceId": "2026-pa-senate-class-2",
  "pollster": "Example Polling",
  "sponsor": "Example News",
  "startDate": "2026-09-01",
  "endDate": "2026-09-03",
  "sampleSize": 800,
  "population": "LV",
  "marginOfError": 3.5,
  "url": "https://example.com/poll",
  "sample": false,
  "results": [
    { "candidateId": "some-id", "percent": 48 },
    { "candidateId": "other-id", "percent": 46 }
  ]
}
```

Results print in the order written. They do not have to sum to 100. Omit `sponsor`, `sampleSize`, `population`, `marginOfError`, or `url` when you do not have them. Set `sample` to `true` for placeholder numbers.

Race ids look like `2026-pa-governor`, `2026-pa-senate-class-2`, `2026-fl-senate-special`, `2026-pa-house-7`, and `2026-ak-house-at-large`.

## Add an extra race

A contest that is not in the generated November roster, such as a House special, goes in `src/data/extra-races/one-id.json`.

```json
{
  "id": "2026-pa-house-7",
  "office": "house",
  "state": "pa",
  "district": 7,
  "seat": null,
  "title": "Pennsylvania House district 7"
}
```

`office` is `governor`, `senate`, or `house`. Governor rows use `district: null` and `seat: null`. Senate rows use `seat` of `class-2` or `special`. House rows use a district number or `"at-large"`.
