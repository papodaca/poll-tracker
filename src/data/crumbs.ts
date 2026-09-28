import { stateByCode } from './states.ts';

export interface Crumb {
	href: string;
	label: string;
}

function raceLabel(segments: string[]): string | undefined {
	const office = segments[1];
	const rest = segments[2];
	if (office === 'governor' && segments.length === 2) return 'Governor';
	if (office === 'senate' && segments.length === 3) {
		if (rest === 'class-2') return 'Senate, Class II';
		if (rest === 'special') return 'Senate, special election';
	}
	if (office === 'house' && segments.length === 3) {
		if (rest === 'at-large') return 'House at-large';
		if (rest && /^[1-9]\d*$/.test(rest)) return `House district ${rest}`;
	}
	return undefined;
}

export function crumbsForPath(pathname: string): Crumb[] {
	const path = decodeURIComponent(pathname).replace(/\/+$/, '') || '/';
	const home: Crumb = { href: '/', label: '2026 polls' };
	if (path === '/') return [home];

	const segments = path.split('/').filter(Boolean);
	const state = stateByCode(segments[0] ?? '');
	if (!state) return [home];

	const stateCrumb: Crumb = { href: `/${state.code}`, label: state.name };
	const label = raceLabel(segments);
	if (!label) return [home, stateCrumb];
	return [home, stateCrumb, { href: path, label }];
}
