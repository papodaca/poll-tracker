import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export const dataRoot = path.join(root, 'src', 'data');
export const publicRoot = path.join(root, 'public');

export function readJsonDir(dir: string): { file: string; data: unknown }[] {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith('.json'))
		.sort()
		.map((name) => {
			const file = path.join(dir, name);
			return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) as unknown };
		});
}

export function portraitFile(portrait: string): string {
	return path.join(publicRoot, portrait);
}
