import fs from 'node:fs';
import { getRosterRaces, racePath } from '../src/data/races.ts';
import { stateByCode } from '../src/data/states.ts';

const listPath = 'docs/races-2026.json';

const officeOrder = { senate: 0, governor: 1, house: 2 } as const;

const races = getRosterRaces().sort((a, b) => {
	const byOffice = officeOrder[a.office] - officeOrder[b.office];
	if (byOffice !== 0) return byOffice;
	if (a.state !== b.state) return a.state.localeCompare(b.state);
	const aDistrict = a.district === 'at-large' ? 0 : Number(a.district ?? 0);
	const bDistrict = b.district === 'at-large' ? 0 : Number(b.district ?? 0);
	return aDistrict - bDistrict;
});

const previous = readPreviousUpdates(listPath);

const list = races.map((race) => {
	const name = stateByCode(race.state)?.name ?? race.state;
	return {
		id: race.id,
		title: race.title,
		office: race.office,
		state: race.state,
		district: race.district,
		seat: race.seat,
		path: racePath(race),
		search: searchQuery(name, race.office, race.district, race.seat),
		lastUpdated: previous.get(race.id) ?? null,
	};
});

const senate = list.filter((race) => race.office === 'senate').length;
const governor = list.filter((race) => race.office === 'governor').length;
const house = list.filter((race) => race.office === 'house').length;
if (senate !== 35 || governor !== 36 || house !== 435) {
	throw new Error(`Unexpected roster counts: ${senate} Senate, ${governor} governor, ${house} House`);
}

fs.writeFileSync(listPath, `${JSON.stringify(list, null, 2)}\n`);
process.stdout.write(`Wrote ${list.length} races to ${listPath}\n`);

function readPreviousUpdates(file: string): Map<string, string> {
	if (!fs.existsSync(file)) return new Map();
	const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as { id?: string; lastUpdated?: unknown }[];
	const updates = new Map<string, string>();
	for (const row of rows) {
		if (typeof row.id === 'string' && typeof row.lastUpdated === 'string') {
			updates.set(row.id, row.lastUpdated);
		}
	}
	return updates;
}

function searchQuery(
	name: string,
	office: 'senate' | 'governor' | 'house',
	district: number | 'at-large' | null,
	seat: 'class-2' | 'special' | null,
): string {
	if (office === 'senate' && seat === 'special') return `${name} Senate special election poll 2026`;
	if (office === 'senate') return `${name} Senate poll 2026`;
	if (office === 'governor') return `${name} governor poll 2026`;
	if (district === 'at-large') return `${name} at-large U.S. House poll 2026`;
	return `${name} ${district} congressional district poll 2026`;
}
