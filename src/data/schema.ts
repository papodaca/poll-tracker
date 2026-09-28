import { z } from 'zod';

const stateCode = z.string().regex(/^[a-z]{2}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const raceSchema = z
	.object({
		id: z.string(),
		office: z.enum(['governor', 'senate', 'house']),
		state: stateCode,
		district: z.union([z.number().int().positive(), z.literal('at-large')]).nullable(),
		seat: z.enum(['class-2', 'special']).nullable(),
		title: z.string().min(1),
	})
	.strict()
	.superRefine((race, ctx) => {
		if (race.office === 'governor') {
			if (race.district !== null) {
				ctx.addIssue({ code: 'custom', message: 'Governor races have no district', path: ['district'] });
			}
			if (race.seat !== null) {
				ctx.addIssue({ code: 'custom', message: 'Governor races have no Senate seat', path: ['seat'] });
			}
			expectId(ctx, race.id, `2026-${race.state}-governor`);
			return;
		}

		if (race.office === 'senate') {
			if (race.district !== null) {
				ctx.addIssue({ code: 'custom', message: 'Senate races have no district', path: ['district'] });
			}
			if (race.seat === null) {
				ctx.addIssue({ code: 'custom', message: 'Senate races need a seat', path: ['seat'] });
				return;
			}
			expectId(ctx, race.id, `2026-${race.state}-senate-${race.seat}`);
			return;
		}

		if (race.seat !== null) {
			ctx.addIssue({ code: 'custom', message: 'House races have no Senate seat', path: ['seat'] });
		}
		if (race.district === null) {
			ctx.addIssue({ code: 'custom', message: 'House races need a district', path: ['district'] });
			return;
		}
		expectId(ctx, race.id, `2026-${race.state}-house-${race.district}`);
	});

export const candidateSchema = z
	.object({
		id: z.string().regex(/^[a-z0-9-]+$/),
		raceId: z.string().min(1),
		name: z.string().min(1),
		party: z.string().min(1),
		portrait: z
			.string()
			.regex(/^portraits\/[a-z0-9-]+\.(svg|png|jpe?g|webp)$/)
			.nullable(),
	})
	.strict();

export const pollSchema = z
	.object({
		id: z.string().regex(/^[a-z0-9-]+$/),
		raceId: z.string().min(1),
		pollster: z.string().min(1),
		sponsor: z.string().min(1).optional(),
		startDate: isoDate,
		endDate: isoDate,
		sampleSize: z.number().int().positive().optional(),
		population: z.string().min(1).optional(),
		marginOfError: z.number().positive().optional(),
		url: z.url().optional(),
		sample: z.boolean(),
		results: z
			.array(
				z
					.object({
						candidateId: z.string().min(1),
						percent: z.number().finite(),
					})
					.strict(),
			)
			.min(1),
	})
	.strict()
	.superRefine((poll, ctx) => {
		if (!isRealIsoDate(poll.startDate)) {
			ctx.addIssue({ code: 'custom', message: 'startDate is not a real calendar date', path: ['startDate'] });
		}
		if (!isRealIsoDate(poll.endDate)) {
			ctx.addIssue({ code: 'custom', message: 'endDate is not a real calendar date', path: ['endDate'] });
		}
		if (isRealIsoDate(poll.startDate) && isRealIsoDate(poll.endDate) && poll.endDate < poll.startDate) {
			ctx.addIssue({ code: 'custom', message: 'endDate is before startDate', path: ['endDate'] });
		}
		const seen = new Set<string>();
		for (const [index, result] of poll.results.entries()) {
			if (seen.has(result.candidateId)) {
				ctx.addIssue({
					code: 'custom',
					message: `duplicate candidate ${result.candidateId}`,
					path: ['results', index, 'candidateId'],
				});
			}
			seen.add(result.candidateId);
		}
	});

export type Race = z.infer<typeof raceSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type Poll = z.infer<typeof pollSchema>;

export function isRealIsoDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function expectId(ctx: z.RefinementCtx, actual: string, expected: string) {
	if (actual !== expected) {
		ctx.addIssue({ code: 'custom', message: `id must be ${expected}`, path: ['id'] });
	}
}
