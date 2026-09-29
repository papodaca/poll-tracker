/**
 * Polls from FiftyPlusOne.
 *
 * Pages https://fiftyplusone.news/api/polls the same way the latest-polls
 * page does: offset, limit, sortBy=created_at, dir=DESC, with that page as
 * the referer.
 *
 * Keeps 2026 general-election Senate, governor, and House horse races.
 * Drops primaries, favorability, generic ballot, and crosstabs. When a poll
 * has both a likely-voter and a registered-voter question for the same
 * candidates, keeps the likely-voter one. Creates a candidate file when the
 * person is not already filed. The API includes the party.
 *
 * Usage: node scripts/fetch-fpo-polls.ts [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { governorStates } from '../src/data/governors.ts';
import { dataRoot, readJsonDir } from '../src/data/load.ts';
import { senateRaces } from '../src/data/senate.ts';
import { states } from '../src/data/states.ts';
import type { Candidate, Poll } from '../src/data/schema.ts';

const API = 'https://fiftyplusone.news/api/polls';
const REFERER = 'https://fiftyplusone.news/latest-polls';
const USER_AGENT =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
const PAGE_SIZE = 100;

const PARTY: Record<string, string> = {
	DEM: 'Democratic',
	REP: 'Republican',
	LIB: 'Libertarian',
	IND: 'independent',
	GRN: 'Green',
	CON: 'Constitution Party',
};

interface FpoAnswer {
	pct: number;
	party: string | null;
	answer: string;
	horserace: boolean;
	candidate: { name: string; party: string | null } | null;
}

interface FpoQuestion {
	cycle: number | null;
	stage: string | null;
	answers: FpoAnswer[];
	seat_name: string | null;
	population: string | null;
	office_type: string | null;
	sample_size: number | null;
	filter_value: string | null;
	subpopulation: string | null;
	url: string | null;
}

interface FpoPoll {
	end_date: string;
	start_date: string;
	state: string | null;
	url: string | null;
	pollster: {
		name?: string | null;
		display_name?: string | null;
		sponsors: { display_name: string }[] | null;
	} | null;
	questions: FpoQuestion[];
}

interface Page {
	count: number;
	total: number | string;
	data: FpoPoll[];
}

const dryRun = process.argv.includes('--dry-run');
const candidatesDir = path.join(dataRoot, 'candidates');
const pollsDir = path.join(dataRoot, 'polls');
const stateByName = new Map(states.map((state) => [state.name, state]));
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

async function getPage(offset: number): Promise<Page> {
	const url = `${API}?offset=${offset}&limit=${PAGE_SIZE}&sortBy=created_at&dir=DESC`;
	const response = await fetch(url, {
		headers: { 'User-Agent': USER_AGENT, Referer: REFERER, Accept: 'application/json' },
	});
	if (!response.ok) throw new Error(`${response.status} ${url}`);
	return (await response.json()) as Page;
}

function partyName(code: string | null): string | null {
	if (!code) return null;
	return PARTY[code] ?? null;
}

function raceIdFor(question: FpoQuestion, stateName: string | null): string | null {
	if (question.cycle !== 2026 || question.stage !== 'general' || question.subpopulation) return null;
	const state = stateName ? stateByName.get(stateName) : undefined;
	if (!state) return null;
	if (question.filter_value === 'senate_general' && question.office_type === 'U.S. Senate') {
		const seat = senateSeat.get(state.code);
		if (!seat) return null;
		if (question.seat_name === 'Class II') return seat === 'class-2' ? `2026-${state.code}-senate-class-2` : null;
		if (question.seat_name === 'Class III') return seat === 'special' ? `2026-${state.code}-senate-special` : null;
		return null;
	}
	if (question.filter_value === 'governor_general' && question.office_type === 'Governor') {
		if (!governorSet.has(state.code)) return null;
		return `2026-${state.code}-governor`;
	}
	if (question.filter_value === 'house_general' && question.office_type === 'U.S. House') {
		const seat = question.seat_name ?? '';
		if (/generic/i.test(seat)) return null;
		let district: string | null = null;
		if (/at[ -]?large/i.test(seat)) district = state.houseSeats === 1 ? 'at-large' : null;
		const numbered = /District\s+(\d+)/i.exec(seat);
		if (numbered) {
			const n = Number(numbered[1]);
			if (state.houseSeats === 1) district = 'at-large';
			else if (n >= 1 && n <= state.houseSeats) district = String(n);
		}
		if (!district) return null;
		return `2026-${state.code}-house-${district}`;
	}
	return null;
}

function officePrefix(raceId: string): string | null {
	const senate = /^2026-([a-z]{2})-senate-/.exec(raceId);
	if (senate) return `${senate[1]}-senate`;
	const governor = /^2026-([a-z]{2})-governor$/.exec(raceId);
	if (governor) return `${governor[1]}-governor`;
	const house = /^2026-([a-z]{2})-house-(.+)$/.exec(raceId);
	if (house) return `${house[1]}-house-${house[2]}`;
	return null;
}

function populationRank(population: string | null): number {
	if (population === 'lv') return 0;
	if (population === 'rv') return 1;
	if (population === 'a') return 2;
	return 3;
}

function answerNames(question: FpoQuestion): string[] {
	return question.answers
		.filter((answer) => answer.horserace && answer.candidate?.name)
		.map((answer) => slug(answer.candidate!.name))
		.sort();
}

function writeJson(file: string, value: unknown) {
	if (dryRun) return;
	fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
	const candidates = readJsonDir(candidatesDir).map((entry) => entry.data as Candidate);
	const polls = readJsonDir(pollsDir).map((entry) => entry.data as Poll);
	const candidateIds = new Set(candidates.map((candidate) => candidate.id));
	const pollIds = new Set(polls.map((poll) => poll.id));
	let wrotePolls = 0;
	let wroteCandidates = 0;
	let skipped = 0;
	let offset = 0;
	let total = Infinity;

	while (offset < total) {
		const page = await getPage(offset);
		total = Number(page.total);
		if (page.data.length === 0) break;
		console.log(`offset ${offset} of ${total}`);
		for (const poll of page.data) {
			const questions = poll.questions.filter((question) => raceIdFor(question, poll.state));
			const kept: FpoQuestion[] = [];
			for (const question of questions) {
				const raceId = raceIdFor(question, poll.state);
				const names = answerNames(question).join('|');
				const better = questions.some(
					(other) =>
						other !== question &&
						raceIdFor(other, poll.state) === raceId &&
						answerNames(other).join('|') === names &&
						populationRank(other.population) < populationRank(question.population),
				);
				if (!better) kept.push(question);
			}
			for (const question of kept) {
				const raceId = raceIdFor(question, poll.state);
				const prefix = raceId ? officePrefix(raceId) : null;
				if (!raceId || !prefix) {
					skipped += 1;
					continue;
				}
				const horse = question.answers.filter((answer) => answer.horserace && answer.candidate?.name);
				if (horse.length < 2) {
					skipped += 1;
					continue;
				}
				const pollster = (poll.pollster?.display_name || poll.pollster?.name || '').trim();
				if (!pollster) {
					skipped += 1;
					continue;
				}
				const names = horse.map((answer) => slug(answer.candidate!.name)).sort();
				const already = polls.some((existing) => {
					if (existing.raceId !== raceId || existing.endDate !== poll.end_date || !samePollster(existing.pollster, pollster)) {
						return false;
					}
					const existingNames = existing.results
						.map((result) => candidates.find((candidate) => candidate.id === result.candidateId)?.name)
						.filter((name): name is string => Boolean(name))
						.map((name) => slug(name))
						.sort();
					return existingNames.join('|') === names.join('|');
				});
				if (already) {
					skipped += 1;
					continue;
				}
				const results: { candidateId: string; percent: number }[] = [];
				const fresh: Candidate[] = [];
				let blocked = false;
				for (const answer of horse) {
					const name = answer.candidate!.name.trim();
					const nameSlug = slug(name);
					const party = partyName(answer.candidate!.party ?? answer.party);
					const existing = candidates.find(
						(candidate) => candidate.raceId === raceId && slug(candidate.name) === nameSlug,
					);
					const staged = fresh.find((candidate) => slug(candidate.name) === nameSlug);
					let candidateId = existing?.id ?? staged?.id;
					if (!candidateId) {
						if (!party) {
							console.warn(`warning: ${raceId} ${pollster}: no party for ${name}`);
							blocked = true;
							break;
						}
						candidateId = `${prefix}-${nameSlug}`;
						if (candidateIds.has(candidateId) || fresh.some((candidate) => candidate.id === candidateId)) {
							candidateId = `${candidateId}-2`;
						}
						fresh.push({ id: candidateId, raceId, name, party, portrait: null });
					}
					results.push({ candidateId, percent: answer.pct });
				}
				if (blocked) {
					skipped += 1;
					continue;
				}
				for (const candidate of fresh) {
					writeJson(path.join(candidatesDir, `${candidate.id}.json`), candidate);
					candidates.push(candidate);
					candidateIds.add(candidate.id);
					wroteCandidates += 1;
				}
				const sponsors = (poll.pollster?.sponsors ?? []).map((sponsor) => sponsor.display_name).filter(Boolean);
				const population = question.population ? question.population.toUpperCase() : undefined;
				let pollId = `${slug(pollster)}-${poll.end_date}-${raceId.slice('2026-'.length)}`;
				while (pollIds.has(pollId)) pollId = `${pollId}-2`;
				const record: Poll = {
					id: pollId,
					raceId,
					pollster,
					...(sponsors.length > 0 ? { sponsor: sponsors.join(' / ') } : {}),
					startDate: poll.start_date,
					endDate: poll.end_date,
					...(question.sample_size ? { sampleSize: question.sample_size } : {}),
					...(population ? { population } : {}),
					...(poll.url ? { url: poll.url } : {}),
					sample: false,
					results,
				};
				writeJson(path.join(pollsDir, `${record.id}.json`), record);
				polls.push(record);
				pollIds.add(record.id);
				wrotePolls += 1;
			}
		}
		offset += page.data.length;
	}

	console.log(
		`${dryRun ? 'Dry run. ' : ''}Wrote ${wrotePolls} polls and ${wroteCandidates} candidates. Skipped ${skipped}.`,
	);
}

await main();
