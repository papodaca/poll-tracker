function basePrefix(): string {
	const base = import.meta.env.BASE_URL;
	if (!base || base === '/') return '';
	return base.endsWith('/') ? base.slice(0, -1) : base;
}

/** Prefix a site path with the Astro `base` used for GitHub Pages. */
export function withBase(path: string): string {
	const prefix = basePrefix();
	const rest = path.startsWith('/') ? path : `/${path}`;
	if (!prefix) return rest;
	if (rest === '/') return `${prefix}/`;
	return `${prefix}${rest}`;
}

/** Drop the Astro `base` so route matching sees `/ga`, not `/repo/ga`. */
export function stripBase(pathname: string): string {
	const prefix = basePrefix();
	let path = decodeURIComponent(pathname);
	if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) {
		path = path.slice(prefix.length) || '/';
	}
	return path.replace(/\/+$/, '') || '/';
}
