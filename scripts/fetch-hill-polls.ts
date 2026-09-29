/**
 * First pass of 2026 general-election polls from The Hill / DDHQ.
 *
 * The pages at elections2026.thehill.com are a Nuxt shell. The polls are
 * JSON at /api/polls/averages and /api/polls/averages/{id}/timeseries.
 *
 * Writes missing candidate and poll files. Leaves files that are already
 * there. Does not edit docs/races-2026.json, so a later search can still
 * look for polls this feed does not have.
 *
 * Usage: node scripts/fetch-hill-polls.ts [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataRoot, readJsonDir } from '../src/data/load.ts';
import { governorStates } from '../src/data/governors.ts';
import { senateRaces } from '../src/data/senate.ts';
import { states } from '../src/data/states.ts';
import type { Candidate, Poll } from '../src/data/schema.ts';

const ORIGIN = 'https://elections2026.thehill.com';
const USER_AGENT =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const PARTY_BY_COLOR: Record<string, string> = {
	'#0059c2': 'Democratic',
	'#1473c4': 'Democratic',
	'#d71913': 'Republican',
	'#c82333': 'Republican',
	'#e81b23': 'Republican',
	'#fed105': 'Libertarian',
	'#ffd100': 'Libertarian',
};

const SKIP_LABEL = /undecided|someone else|other|refused|not sure|unsure|will not vote|would not vote|don't know|do not know/i;

interface HillRace {
	year: number;
	state: string;
	office: string;
	district: string;
	electionType: string;
}

interface HillAverage {
	id: number;
	slug: string;
	poll_type: { name: string };
	office_name: string | null;
	title: string;
	total_polls: number;
	race: HillRace | null;
}

interface HillEntry {
	label: string;
	color: string;
	value: number;
}

interface HillMetadata {
	population: string;
	sample_size: number | null;
	poll_type: string;
	entries: HillEntry[];
}

interface HillPoll {
	start_date: string;
	end_date: string;
	pollster_sponsor_name: string;
	source: string | null;
	poll_metadata: HillMetadata[];
}

interface HillTimeseries {
	polls: HillPoll[];
}

const dryRun = process.argv.includes('--dry-run');
const candidatesDir = path.join(dataRoot, 'candidates');
const pollsDir = path.join(dataRoot, 'polls');

const stateByName = new Map(states.map((state) => [state.name, state.code]));
const senateSeat = new Map(senateRaces.map((row) => [row.state, row.seat]));
const governorSet = new Set<string>(governorStates);

function slug(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function words(value: string): string[] {
	return slug(value)
		.split('-')
		.filter((word) => word && word !== 'and' && word !== 'the' && word !== 'of');
}

function samePollster(a: string, b: string): boolean {
	const left = words(a);
	const right = words(b);
	if (left.length === 0 || right.length === 0) return false;
	const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
	return shorter.every((word) => longer.includes(word));
}

function isoDate(value: string): string | null {
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
	return match ? match[1] : null;
}

function splitPollster(name: string): { pollster: string; sponsor?: string } {
	const parts = name.split(' / ').map((part) => part.trim()).filter(Boolean);
	if (parts.length < 2) return { pollster: name.trim() };
	return { pollster: parts.slice(0, -1).join(' / '), sponsor: parts[parts.length - 1] };
}

function percent(value: number): number {
	if (Number.isInteger(value)) return value;
	return Math.round(value * 10) / 10;
}

async function getJson<T>(url: string): Promise<T> {
	const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
	if (!response.ok) throw new Error(`${response.status} ${url}`);
	return (await response.json()) as T;
}

function raceIdFor(average: HillAverage): string | null {
	const race = average.race;
	if (!race || race.year !== 2026) return null;
	if (!/general/i.test(race.electionType) || /primary/i.test(race.electionType)) return null;
	if (average.poll_type.name !== 'General Ballot Test') return null;
	if (!average.slug.endsWith('/lv-rv-adults')) return null;
	const code = stateByName.get(race.state);
	if (!code) return null;
	if (race.office === 'US Senate') {
		const seat = senateSeat.get(code);
		if (!seat) return null;
		return `2026-${code}-senate-${seat}`;
	}
	if (race.office === 'Governor') {
		if (!governorSet.has(code)) return null;
		return `2026-${code}-governor`;
	}
	if (race.office === 'US House') {
		const district = race.district.trim();
		if (!district) return null;
		const key = /^at-?large$/i.test(district) ? 'at-large' : String(Number(district));
		if (key === 'NaN') return null;
		return `2026-${code}-house-${key}`;
	}
	return null;
}

function officeSlug(raceId: string): string | null {
	const senate = /^2026-([a-z]{2})-senate-/.exec(raceId);
	if (senate) return `${senate[1]}-senate`;
	const governor = /^2026-([a-z]{2})-governor$/.exec(raceId);
	if (governor) return `${governor[1]}-governor`;
	const house = /^2026-([a-z]{2})-house-(.+)$/.exec(raceId);
	if (house) return `${house[1]}-house-${house[2]}`;
	return null;
}

function pickScreen(poll: HillPoll): HillMetadata | null {
	const screens = poll.poll_metadata.filter((row) => row.poll_type === 'General Ballot Test' && row.entries.length > 0);
	const likely = screens.filter((row) => row.population === 'LV');
	const pool = likely.length > 0 ? likely : screens.filter((row) => row.population === 'RV');
	if (pool.length === 0) return screens[0] ?? null;
	return pool.reduce((best, row) => ((row.sample_size ?? 0) > (best.sample_size ?? 0) ? row : best));
}

function chooseAverages(averages: HillAverage[]): HillAverage[] {
	const grouped = new Map<string, HillAverage[]>();
	for (const average of averages) {
		const raceId = raceIdFor(average);
		if (!raceId) continue;
		const list = grouped.get(raceId) ?? [];
		list.push(average);
		grouped.set(raceId, list);
	}
	const chosen: HillAverage[] = [];
	for (const [raceId, list] of grouped) {
		const plain = list.filter((average) => !average.slug.includes('-vs-'));
		const pool = plain.length > 0 ? plain : list;
		const best = pool.reduce((left, right) => (right.total_polls > left.total_polls ? right : left));
		if (list.length > 1) {
			const dropped = list.filter((average) => average.id !== best.id).map((average) => average.slug);
			console.log(`${raceId}: using ${best.slug}, skipping ${dropped.join(', ')}`);
		}
		chosen.push(best);
	}
	chosen.sort((a, b) => (raceIdFor(a) ?? '').localeCompare(raceIdFor(b) ?? ''));
	return chosen;
}

function loadCandidates(): Candidate[] {
	return readJsonDir(candidatesDir).map((entry) => entry.data as Candidate);
}

function loadPolls(): Poll[] {
	return readJsonDir(pollsDir).map((entry) => entry.data as Poll);
}

function writeJson(file: string, value: unknown) {
	if (dryRun) return;
	fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
	const averages = await getJson<{ averages: HillAverage[] }>(`${ORIGIN}/api/polls/averages`);
	const selected = chooseAverages(averages.averages);
	const candidates = loadCandidates();
	const polls = loadPolls();
	const candidateIds = new Set(candidates.map((candidate) => candidate.id));
	const pollIds = new Set(polls.map((poll) => poll.id));

	let wrotePolls = 0;
	let wroteCandidates = 0;
	let skipped = 0;

	for (const average of selected) {
		const raceId = raceIdFor(average);
		if (!raceId) continue;
		const prefix = officeSlug(raceId);
		if (!prefix) continue;
		const body = await getJson<HillTimeseries>(`${ORIGIN}/api/polls/averages/${average.id}/timeseries`);
		let added = 0;
		for (const poll of body.polls) {
			const screen = pickScreen(poll);
			const startDate = isoDate(poll.start_date);
			const endDate = isoDate(poll.end_date);
			if (!screen || !startDate || !endDate || endDate < startDate) {
				skipped += 1;
				continue;
			}
			const { pollster, sponsor } = splitPollster(poll.pollster_sponsor_name);
			const already = polls.some(
				(existing) =>
					existing.raceId === raceId &&
					existing.endDate === endDate &&
					(samePollster(existing.pollster, pollster) || (poll.source != null && existing.url === poll.source)),
			);
			if (already) {
				skipped += 1;
				continue;
			}

			const results: { candidateId: string; percent: number }[] = [];
			const fresh: Candidate[] = [];
			let blocked = false;
			for (const entry of screen.entries) {
				if (SKIP_LABEL.test(entry.label)) continue;
				const name = entry.label.trim();
				const nameSlug = slug(name);
				if (!nameSlug) continue;
				const existing = candidates.find(
					(candidate) =>
						candidate.raceId === raceId &&
						(slug(candidate.name) === nameSlug || candidate.id === `${prefix}-${nameSlug}`),
				);
				const staged = fresh.find((candidate) => slug(candidate.name) === nameSlug);
				let candidateId = existing?.id ?? staged?.id;
				if (!candidateId) {
					const party = PARTY_BY_COLOR[entry.color.toLowerCase()];
					if (!party) {
						console.log(`${raceId}: skip ${pollster} ${endDate}, no party for ${name} (${entry.color})`);
						blocked = true;
						break;
					}
					candidateId = `${prefix}-${nameSlug}`;
					if (candidateIds.has(candidateId) || fresh.some((candidate) => candidate.id === candidateId)) {
						candidateId = `${candidateId}-2`;
					}
					fresh.push({ id: candidateId, raceId, name, party, portrait: null });
				}
				results.push({ candidateId, percent: percent(entry.value) });
			}
			if (blocked || results.length < 2) {
				skipped += 1;
				continue;
			}
			for (const candidate of fresh) {
				writeJson(path.join(candidatesDir, `${candidate.id}.json`), candidate);
				candidates.push(candidate);
				candidateIds.add(candidate.id);
				wroteCandidates += 1;
			}

			let pollId = `${slug(pollster)}-${endDate}-${raceId.slice('2026-'.length)}`;
			while (pollIds.has(pollId)) pollId = `${pollId}-2`;
			const record: Poll = {
				id: pollId,
				raceId,
				pollster,
				...(sponsor ? { sponsor } : {}),
				startDate,
				endDate,
				...(screen.sample_size ? { sampleSize: screen.sample_size } : {}),
				population: screen.population,
				...(poll.source ? { url: poll.source } : {}),
				sample: false,
				results,
			};
			writeJson(path.join(pollsDir, `${record.id}.json`), record);
			polls.push(record);
			pollIds.add(record.id);
			wrotePolls += 1;
			added += 1;
		}
		console.log(`${raceId}: ${added} new from ${body.polls.length} in ${average.slug}`);
	}

	console.log(
		`${dryRun ? 'Dry run. ' : ''}Wrote ${wrotePolls} polls and ${wroteCandidates} candidates. Skipped ${skipped}.`,
	);
}

await main();
