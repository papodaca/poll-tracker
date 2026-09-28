import path from 'node:path';
import { dataRoot, readJsonDir } from './load.ts';
import { pollSchema, type Poll } from './schema.ts';

export function loadPolls(): Poll[] {
	return readJsonDir(path.join(dataRoot, 'polls')).map((entry) => pollSchema.parse(entry.data));
}

export function pollCountByState(polls: Poll[], raceStateById: Map<string, string>): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const poll of polls) {
		const state = raceStateById.get(poll.raceId);
		if (!state) continue;
		counts[state] = (counts[state] ?? 0) + 1;
	}
	return counts;
}
