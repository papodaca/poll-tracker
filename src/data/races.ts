import path from 'node:path';
import { governorStates } from './governors.ts';
import { dataRoot, readJsonDir } from './load.ts';
import { raceSchema, type Race } from './schema.ts';
import { senateRaces } from './senate.ts';
import { stateByCode, states } from './states.ts';

function requireStateName(code: string): string {
	const state = stateByCode(code);
	if (!state) throw new Error(`Unknown state ${code}`);
	return state.name;
}

export function getRosterRaces(): Race[] {
	const races: Race[] = [];

	for (const state of states) {
		if (state.houseSeats === 1) {
			races.push({
				id: `2026-${state.code}-house-at-large`,
				office: 'house',
				state: state.code,
				district: 'at-large',
				seat: null,
				title: `${state.name} House at-large`,
			});
			continue;
		}

		for (let district = 1; district <= state.houseSeats; district++) {
			races.push({
				id: `2026-${state.code}-house-${district}`,
				office: 'house',
				state: state.code,
				district,
				seat: null,
				title: `${state.name} House district ${district}`,
			});
		}
	}

	for (const row of senateRaces) {
		const name = requireStateName(row.state);
		const label = row.seat === 'class-2' ? 'Class II' : 'special election';
		races.push({
			id: `2026-${row.state}-senate-${row.seat}`,
			office: 'senate',
			state: row.state,
			district: null,
			seat: row.seat,
			title: `${name} Senate, ${label}`,
		});
	}

	for (const code of governorStates) {
		races.push({
			id: `2026-${code}-governor`,
			office: 'governor',
			state: code,
			district: null,
			seat: null,
			title: `${requireStateName(code)} governor`,
		});
	}

	return races;
}

export function getExtraRaces(): Race[] {
	return readJsonDir(path.join(dataRoot, 'extra-races')).map((entry) => raceSchema.parse(entry.data));
}

export function getRaces(): Race[] {
	return [...getRosterRaces(), ...getExtraRaces()];
}

export function racePath(race: Race): string {
	if (race.office === 'governor') return `/${race.state}/governor`;
	if (race.office === 'senate') return `/${race.state}/senate/${race.seat}`;
	return `/${race.state}/house/${race.district}`;
}
