import fs from 'node:fs';
import path from 'node:path';
import { dataRoot, portraitFile, readJsonDir } from '../src/data/load.ts';
import { getRosterRaces } from '../src/data/races.ts';
import { candidateSchema, pollSchema, raceSchema, type Candidate, type Poll, type Race } from '../src/data/schema.ts';

const errors: string[] = [];

function fail(message: string) {
	errors.push(message);
}

function parseAll<T>(dir: string, schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: { message: string } } }): T[] {
	const parsed: T[] = [];
	for (const entry of readJsonDir(dir)) {
		const result = schema.safeParse(entry.data);
		if (!result.success) {
			fail(`${path.relative(dataRoot, entry.file)}: ${result.error.message}`);
			continue;
		}
		parsed.push(result.data);
	}
	return parsed;
}

const roster = getRosterRaces();
const extras = parseAll<Race>(path.join(dataRoot, 'extra-races'), raceSchema);
const candidates = parseAll<Candidate>(path.join(dataRoot, 'candidates'), candidateSchema);
const polls = parseAll<Poll>(path.join(dataRoot, 'polls'), pollSchema);

if (roster.length === 0) {
	console.log('Roster is empty. Count checks run once races are generated.');
} else {
	for (const [index, race] of roster.entries()) {
		const result = raceSchema.safeParse(race);
		if (!result.success) {
			fail(`roster[${index}]: ${result.error.message}`);
		}
	}
	const house = roster.filter((race) => race.office === 'house').length;
	const senate = roster.filter((race) => race.office === 'senate').length;
	const governor = roster.filter((race) => race.office === 'governor').length;
	if (house !== 435) fail(`Expected 435 House races, found ${house}`);
	if (senate !== 35) fail(`Expected 35 Senate races, found ${senate}`);
	if (governor !== 36) fail(`Expected 36 governor races, found ${governor}`);
}

const races = [...roster, ...extras];
const raceIds = new Set<string>();
for (const race of races) {
	if (raceIds.has(race.id)) fail(`Duplicate race id ${race.id}`);
	raceIds.add(race.id);
}

const candidatesById = new Map<string, Candidate>();
for (const candidate of candidates) {
	if (candidatesById.has(candidate.id)) fail(`Duplicate candidate id ${candidate.id}`);
	candidatesById.set(candidate.id, candidate);
	if (!raceIds.has(candidate.raceId)) fail(`Candidate ${candidate.id} points at missing race ${candidate.raceId}`);
	if (candidate.portrait && !fs.existsSync(portraitFile(candidate.portrait))) {
		fail(`Candidate ${candidate.id} portrait is missing: public/${candidate.portrait}`);
	}
}

const pollIds = new Set<string>();
for (const poll of polls) {
	if (pollIds.has(poll.id)) fail(`Duplicate poll id ${poll.id}`);
	pollIds.add(poll.id);
	if (!raceIds.has(poll.raceId)) {
		fail(`Poll ${poll.id} points at missing race ${poll.raceId}`);
		continue;
	}
	for (const result of poll.results) {
		const candidate = candidatesById.get(result.candidateId);
		if (!candidate) {
			fail(`Poll ${poll.id} points at missing candidate ${result.candidateId}`);
			continue;
		}
		if (candidate.raceId !== poll.raceId) {
			fail(`Poll ${poll.id} uses ${result.candidateId}, who is on ${candidate.raceId}`);
		}
	}
}

if (errors.length > 0) {
	console.error(errors.join('\n'));
	process.exit(1);
}

console.log(`Checked ${races.length} races, ${candidates.length} candidates, ${polls.length} polls.`);
