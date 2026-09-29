/**
 * Polls from Race to the WH.
 *
 * Neither page contains the table. Load the page, load the Infogram iframe,
 * then read one live block. That block's key is the feed at
 * https://live-data.jifo.co/{key}.
 *
 * Senate uses "Sen 26 - Publish Poll List". A sheet is used only when both
 * names match candidates already filed for that race, one Democratic and one
 * Republican.
 *
 * House uses "House 26 - Latest Polls Added". A row names only the leader.
 * The other percent is filed only when that party has exactly one candidate
 * on the race. Otherwise the row is skipped and a warning is printed.
 *
 * Usage: node scripts/fetch-rtwh-polls.ts [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataRoot, readJsonDir } from '../src/data/load.ts';
import { senateRaces } from '../src/data/senate.ts';
import { states } from '../src/data/states.ts';
import type { Candidate, Poll } from '../src/data/schema.ts';

const SENATE_PAGE = 'https://www.racetothewh.com/senate/26polls';
const HOUSE_PAGE = 'https://www.racetothewh.com/house/26polls';
const LIVE = 'https://live-data.jifo.co';
const SENATE_CHART = 'Sen 26 - Publish Poll List';
const HOUSE_CHART = 'House 26 - Latest Polls Added';
const USER_AGENT =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const MONTHS: Record<string, number> = {
	jan: 1,
	feb: 2,
	mar: 3,
	apr: 4,
	may: 5,
	jun: 6,
	jul: 7,
	aug: 8,
	sep: 9,
	oct: 10,
	nov: 11,
	dec: 12,
};

interface Cell {
	type?: string;
	href?: string;
	value?: string;
}

interface Feed {
	data: unknown[][];
	sheetNames: string[];
	refreshed: string;
}

const dryRun = process.argv.includes('--dry-run');
const candidatesDir = path.join(dataRoot, 'candidates');
const pollsDir = path.join(dataRoot, 'polls');
const senateSeat = new Map(senateRaces.map((row) => [row.state, row.seat]));
const houseSeats = new Map(states.map((state) => [state.code, state.houseSeats]));

function slug(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function letters(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z]/g, '');
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

async function getText(url: string): Promise<string> {
	const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
	if (!response.ok) throw new Error(`${response.status} ${url}`);
	return response.text();
}

async function getJson<T>(url: string): Promise<T> {
	const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
	if (!response.ok) throw new Error(`${response.status} ${url}`);
	return (await response.json()) as T;
}

function iframeSrcs(html: string): string[] {
	const srcs: string[] = [];
	for (const match of html.matchAll(/<iframe\b[^>]*>/gi)) {
		const tag = match[0];
		const src = /src="([^"]+)"/i.exec(tag)?.[1];
		if (!src || !src.includes('infogram.com')) continue;
		srcs.push(src.replace(/&amp;/g, '&'));
	}
	return srcs;
}

function liveKey(frameHtml: string, chartTitle: string): string | null {
	const marker = `"title":"${chartTitle}"`;
	const at = frameHtml.indexOf(marker);
	if (at < 0) return null;
	const live = frameHtml.slice(Math.max(0, at - 800), at);
	const key = /"key":"([0-9a-f-]{36})"/.exec(live)?.[1];
	return key ?? null;
}

async function loadFeed(pageUrl: string, chartTitle: string): Promise<Feed> {
	const page = await getText(pageUrl);
	const srcs = iframeSrcs(page);
	if (srcs.length === 0) throw new Error(`No Infogram iframe on ${pageUrl}`);
	for (const src of srcs) {
		const frame = await getText(src);
		const key = liveKey(frame, chartTitle);
		if (!key) continue;
		console.log(`Feed ${LIVE}/${key} from ${src}`);
		return getJson<Feed>(`${LIVE}/${key}`);
	}
	throw new Error(`Iframes on ${pageUrl} did not contain ${chartTitle}`);
}

function lastName(name: string): string {
	const parts = name
		.replace(/\./g, '')
		.split(/\s+/)
		.filter(Boolean);
	const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
	while (parts.length > 1 && suffixes.has(parts[parts.length - 1].toLowerCase())) parts.pop();
	return letters(parts[parts.length - 1] ?? '');
}

function firstName(name: string): string {
	return letters(name.split(/\s+/)[0] ?? '');
}

interface Side {
	initial: string | null;
	last: string;
}

function parseSide(label: string): Side | null {
	const cleaned = label.replace(/^Gov\.\s*/i, '').trim();
	if (/generic/i.test(cleaned)) return null;
	const parts = cleaned.split(/\s+/).filter(Boolean);
	if (parts.length === 0) return null;
	const initial = parts.length > 1 && /^[A-Za-z]\.$/.test(parts[0]) ? parts[0][0].toLowerCase() : null;
	const last = letters(parts[parts.length - 1]);
	if (!last) return null;
	return { initial, last };
}

function matchSide(side: Side, candidates: Candidate[]): Candidate | null {
	const hits = candidates.filter((candidate) => {
		if (lastName(candidate.name) !== side.last) return false;
		if (!side.initial) return true;
		return firstName(candidate.name).startsWith(side.initial);
	});
	return hits.length === 1 ? hits[0] : null;
}

function isDemocrat(party: string): boolean {
	return party === 'Democratic' || party === 'Democrat';
}

function isRepublican(party: string): boolean {
	return party === 'Republican';
}

function sheetPair(name: string): { state: string; left: Side; right: Side } | null {
	const match = /^([A-Z]{2}) - (.+?) v\. (.+)$/.exec(name);
	if (!match) return null;
	const left = parseSide(match[2]);
	const right = parseSide(match[3]);
	if (!left || !right) return null;
	return { state: match[1].toLowerCase(), left, right };
}

function cellText(cell: unknown): string {
	if (typeof cell === 'string') return cell.trim();
	if (cell && typeof cell === 'object' && 'value' in cell && typeof cell.value === 'string') return cell.value.trim();
	return '';
}

function cellHref(cell: unknown): string | undefined {
	if (cell && typeof cell === 'object' && 'href' in cell && typeof cell.href === 'string') return cell.href;
	return undefined;
}

function iso(year: number, month: number, day: number): string | null {
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
	const monthText = String(month).padStart(2, '0');
	const dayText = String(day).padStart(2, '0');
	return `${year}-${monthText}-${dayText}`;
}

function fieldDates(text: string, refreshed: Date): { startDate: string; endDate: string } | null {
	let year: number | null = null;
	let body = text.trim();
	const yearMatch = /,\s*(\d{2}|\d{4})$/.exec(body);
	if (yearMatch) {
		const value = Number(yearMatch[1]);
		year = value < 100 ? 2000 + value : value;
		body = body.slice(0, yearMatch.index).trim();
	}
	const match = /^([A-Za-z]+)\s+(\d{1,2})\s*-\s*(?:([A-Za-z]+)\s+)?(\d{1,2})$/.exec(body);
	if (!match) return null;
	const startMonth = MONTHS[match[1].slice(0, 3).toLowerCase()];
	const endMonth = match[3] ? MONTHS[match[3].slice(0, 3).toLowerCase()] : startMonth;
	if (!startMonth || !endMonth) return null;
	let endYear = year ?? refreshed.getUTCFullYear();
	let startYear = endYear;
	if (startMonth > endMonth) startYear -= 1;
	if (year == null) {
		const end = new Date(Date.UTC(endYear, endMonth - 1, Number(match[4])));
		if (end.getTime() > refreshed.getTime()) {
			endYear -= 1;
			startYear -= 1;
		}
	}
	const startDate = iso(startYear, startMonth, Number(match[2]));
	const endDate = iso(endYear, endMonth, Number(match[4]));
	if (!startDate || !endDate || endDate < startDate) return null;
	return { startDate, endDate };
}

function parsePoll(text: string, refreshed: Date): {
	startDate: string;
	endDate: string;
	pollster: string;
	sponsor?: string;
	sampleSize?: number;
	population: string;
} | null {
	const split = /^(.+?):\s+(.+)$/.exec(text);
	if (!split) return null;
	const dates = fieldDates(split[1], refreshed);
	const sample = /^(.*?),\s*(\d+)\s+([A-Za-z]+)\b/.exec(split[2]);
	if (!dates || !sample) return null;
	const parens: string[] = [];
	let name = sample[1].trim();
	for (;;) {
		const wrapped = /^(.*)\(([^)]+)\)\s*$/.exec(name);
		if (!wrapped) break;
		parens.unshift(wrapped[2].trim());
		name = wrapped[1].trim();
	}
	if (parens.length > 0 && /^[A-F][+-]?$/.test(parens[parens.length - 1])) parens.pop();
	if (!name) return null;
	const population = sample[3].toUpperCase();
	return {
		...dates,
		pollster: name,
		...(parens.length > 0 ? { sponsor: parens.join(' / ') } : {}),
		sampleSize: Number(sample[2]),
		population,
	};
}

function percent(cell: unknown): number | null {
	const text = cellText(cell).replace('%', '');
	if (!text || text === '-') return null;
	const value = Number(text);
	if (!Number.isFinite(value)) return null;
	return Number.isInteger(value) ? value : Math.round(value * 10) / 10;
}

function writeJson(file: string, value: unknown) {
	if (dryRun) return;
	fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function houseRaceId(label: string): string | null {
	const match = /^([A-Z]{2}) - (\d+)$/.exec(label.trim());
	if (!match) return null;
	const code = match[1].toLowerCase();
	const seats = houseSeats.get(code);
	const district = Number(match[2]);
	if (seats == null) return null;
	if (district === 0) return seats === 1 ? `2026-${code}-house-at-large` : null;
	if (district < 1 || district > seats) return null;
	return `2026-${code}-house-${district}`;
}

function addedDate(text: string, refreshed: Date): string | null {
	const match = /^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{2}|\d{4}))?$/.exec(text.trim());
	if (!match) return null;
	const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
	if (!month) return null;
	let year = match[3] ? Number(match[3]) : refreshed.getUTCFullYear();
	if (year < 100) year += 2000;
	const day = Number(match[2]);
	if (!match[3]) {
		const stamp = new Date(Date.UTC(year, month - 1, day));
		if (stamp.getTime() > refreshed.getTime()) year -= 1;
	}
	return iso(year, month, day);
}

function partySide(mark: string, candidate: Candidate): boolean {
	if (mark === 'D') return isDemocrat(candidate.party);
	if (mark === 'R') return isRepublican(candidate.party);
	return false;
}

function matchNamed(label: string, candidates: Candidate[]): { candidate: Candidate; mark: 'D' | 'R' } | null {
	const match = /^(.+?) \(([DR])\)/.exec(label.trim());
	if (!match) return null;
	const side = parseSide(match[1]);
	const mark = match[2] as 'D' | 'R';
	if (!side) return null;
	const hits = candidates.filter((candidate) => {
		if (!partySide(mark, candidate) || lastName(candidate.name) !== side.last) return false;
		if (side.initial && !firstName(candidate.name).startsWith(side.initial)) return false;
		const tokens = letters(match[1]).length > side.last.length ? words(match[1]) : [side.last];
		return tokens.every((token) => words(candidate.name).includes(token));
	});
	return hits.length === 1 ? { candidate: hits[0], mark } : null;
}

function importHouse(
	feed: Feed,
	candidates: Candidate[],
	polls: Poll[],
	pollIds: Set<string>,
): { wrote: number; warned: number } {
	const refreshed = new Date(feed.refreshed);
	const byRace = new Map<string, Candidate[]>();
	for (const candidate of candidates) {
		if (!candidate.raceId.includes('-house-')) continue;
		const list = byRace.get(candidate.raceId) ?? [];
		list.push(candidate);
		byRace.set(candidate.raceId, list);
	}
	let wrote = 0;
	let warned = 0;
	const warn = (message: string) => {
		warned += 1;
		console.warn(`warning: ${message}`);
	};
	const sheet = feed.data[0] ?? [];
	for (const row of sheet.slice(1)) {
		const added = cellText(row[1]);
		const raceLabel = cellText(row[2]);
		const pollster = cellText(row[3]);
		const lead = cellText(row[4]);
		const where = `${raceLabel} ${pollster} ${added}`.trim();
		const raceId = houseRaceId(raceLabel);
		if (!raceId) {
			warn(`${where}: ${raceLabel} is not a House district we track`);
			continue;
		}
		const filed = byRace.get(raceId) ?? [];
		const named = matchNamed(lead, filed);
		if (!named) {
			warn(`${where}: ${lead || 'the leader'} is not a known candidate on ${raceId}`);
			continue;
		}
		const otherMark = named.mark === 'D' ? 'R' : 'D';
		const others = filed.filter((candidate) => partySide(otherMark, candidate));
		if (others.length !== 1) {
			const side = otherMark === 'D' ? 'Democrat' : 'Republican';
			warn(
				`${where}: ${others.length === 0 ? `no ${side} is filed` : `${others.length} ${side}s are filed`} on ${raceId}, not guessing`,
			);
			continue;
		}
		const opponent = others[0];
		const demPercent = percent(row[5]);
		const repPercent = percent(row[6]);
		const endDate = addedDate(added, refreshed);
		if (demPercent == null || repPercent == null || !endDate || !pollster) {
			warn(`${where}: missing a percent or a date`);
			continue;
		}
		const url = cellHref(row[3]);
		const already = polls.some(
			(existing) =>
				existing.raceId === raceId &&
				existing.endDate === endDate &&
				(samePollster(existing.pollster, pollster) || (url != null && existing.url === url)),
		);
		if (already) continue;
		const democrat = named.mark === 'D' ? named.candidate : opponent;
		const republican = named.mark === 'R' ? named.candidate : opponent;
		let pollId = `${slug(pollster)}-${endDate}-${raceId.slice('2026-'.length)}`;
		while (pollIds.has(pollId)) pollId = `${pollId}-2`;
		const record: Poll = {
			id: pollId,
			raceId,
			pollster,
			startDate: endDate,
			endDate,
			...(url ? { url } : {}),
			sample: false,
			results: [
				{ candidateId: democrat.id, percent: demPercent },
				{ candidateId: republican.id, percent: repPercent },
			],
		};
		writeJson(path.join(pollsDir, `${record.id}.json`), record);
		polls.push(record);
		pollIds.add(record.id);
		wrote += 1;
		console.log(`${raceId}: ${pollster} ${endDate}`);
	}
	return { wrote, warned };
}

async function main() {
	const feed = await loadFeed(SENATE_PAGE, SENATE_CHART);
	const refreshed = new Date(feed.refreshed);
	const candidates = readJsonDir(candidatesDir).map((entry) => entry.data as Candidate);
	const polls = readJsonDir(pollsDir).map((entry) => entry.data as Poll);
	const pollIds = new Set(polls.map((poll) => poll.id));
	const byRace = new Map<string, Candidate[]>();
	for (const candidate of candidates) {
		if (!candidate.raceId.includes('-senate-')) continue;
		const list = byRace.get(candidate.raceId) ?? [];
		list.push(candidate);
		byRace.set(candidate.raceId, list);
	}

	let wrote = 0;
	let skippedSheets = 0;
	let skippedRows = 0;

	for (let index = 0; index < feed.sheetNames.length; index += 1) {
		const sheetName = feed.sheetNames[index];
		const pair = sheetPair(sheetName);
		const seat = pair ? senateSeat.get(pair.state) : undefined;
		const raceId = pair && seat ? `2026-${pair.state}-senate-${seat}` : null;
		const filed = raceId ? (byRace.get(raceId) ?? []) : [];
		const left = pair ? matchSide(pair.left, filed) : null;
		const right = pair ? matchSide(pair.right, filed) : null;
		if (!raceId || !left || !right) {
			skippedSheets += 1;
			continue;
		}
		const democrat = [left, right].find((candidate) => isDemocrat(candidate.party));
		const republican = [left, right].find((candidate) => isRepublican(candidate.party));
		if (!democrat || !republican) {
			skippedSheets += 1;
			continue;
		}
		const sheet = feed.data[index] ?? [];
		const header = sheet[0] ?? [];
		const demHeader = cellText(header[2]);
		const repHeader = cellText(header[3]);
		if (!['D', 'DEM'].includes(demHeader) || !['R', 'GOP'].includes(repHeader)) {
			skippedSheets += 1;
			continue;
		}
		let added = 0;
		for (const row of sheet.slice(1)) {
			const text = cellText(row[1]);
			const parsed = parsePoll(text, refreshed);
			const dem = percent(row[2]);
			const rep = percent(row[3]);
			if (!parsed || dem == null || rep == null) {
				skippedRows += 1;
				continue;
			}
			const url = cellHref(row[1]);
			const already = polls.some(
				(existing) =>
					existing.raceId === raceId &&
					existing.endDate === parsed.endDate &&
					(samePollster(existing.pollster, parsed.pollster) || (url != null && existing.url === url)),
			);
			if (already) {
				skippedRows += 1;
				continue;
			}
			let pollId = `${slug(parsed.pollster)}-${parsed.endDate}-${raceId.slice('2026-'.length)}`;
			while (pollIds.has(pollId)) pollId = `${pollId}-2`;
			const record: Poll = {
				id: pollId,
				raceId,
				pollster: parsed.pollster,
				...(parsed.sponsor ? { sponsor: parsed.sponsor } : {}),
				startDate: parsed.startDate,
				endDate: parsed.endDate,
				...(parsed.sampleSize ? { sampleSize: parsed.sampleSize } : {}),
				population: parsed.population,
				...(url ? { url } : {}),
				sample: false,
				results: [
					{ candidateId: democrat.id, percent: dem },
					{ candidateId: republican.id, percent: rep },
				],
			};
			writeJson(path.join(pollsDir, `${record.id}.json`), record);
			polls.push(record);
			pollIds.add(record.id);
			wrote += 1;
			added += 1;
		}
		console.log(`${raceId}: ${added} new from ${sheetName}`);
	}

	const house = await loadFeed(HOUSE_PAGE, HOUSE_CHART);
	const houseResult = importHouse(house, candidates, polls, pollIds);

	console.log(
		`${dryRun ? 'Dry run. ' : ''}Wrote ${wrote} Senate polls and ${houseResult.wrote} House polls. Skipped ${skippedSheets} Senate sheets and ${skippedRows} Senate rows. ${houseResult.warned} House warnings.`,
	);
}

await main();
