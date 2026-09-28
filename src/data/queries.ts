import path from 'node:path';
import { dataRoot, readJsonDir } from './load.ts';
import { candidateSchema, pollSchema, type Candidate, type Poll } from './schema.ts';

export function loadCandidates(): Candidate[] {
	return readJsonDir(path.join(dataRoot, 'candidates')).map((entry) => candidateSchema.parse(entry.data));
}

export function loadPolls(): Poll[] {
	return readJsonDir(path.join(dataRoot, 'polls')).map((entry) => pollSchema.parse(entry.data));
}

export function candidatesForRace(candidates: Candidate[], raceId: string): Candidate[] {
	return candidates.filter((candidate) => candidate.raceId === raceId);
}

export function pollsForRace(polls: Poll[], raceId: string): Poll[] {
	return polls
		.filter((poll) => poll.raceId === raceId)
		.sort((a, b) => b.endDate.localeCompare(a.endDate) || b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id));
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
