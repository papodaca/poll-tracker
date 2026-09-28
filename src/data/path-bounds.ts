// Bounds for the SVG path commands used by the state outlines: m/M, l/L, h/H, v/V, z/Z.

type Token = string | number;

function tokenize(d: string): Token[] {
	const tokens: Token[] = [];
	const pattern = /[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
	for (const match of d.matchAll(pattern)) {
		const text = match[0];
		tokens.push(/[a-zA-Z]/.test(text) ? text : Number(text));
	}
	return tokens;
}

export function pathBounds(d: string): { minX: number; minY: number; width: number; height: number } {
	const tokens = tokenize(d);
	let index = 0;
	let command = '';
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	function read(): number {
		const value = tokens[index++];
		if (typeof value !== 'number') throw new Error(`Expected number in path near ${command}`);
		return value;
	}

	function visit(px: number, py: number) {
		x = px;
		y = py;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}

	while (index < tokens.length) {
		const token = tokens[index];
		if (typeof token === 'string') {
			command = token;
			index += 1;
		} else if (command === 'M') {
			command = 'L';
		} else if (command === 'm') {
			command = 'l';
		}

		switch (command) {
			case 'M':
				visit(read(), read());
				startX = x;
				startY = y;
				break;
			case 'm':
				visit(x + read(), y + read());
				startX = x;
				startY = y;
				break;
			case 'L':
				visit(read(), read());
				break;
			case 'l':
				visit(x + read(), y + read());
				break;
			case 'H':
				visit(read(), y);
				break;
			case 'h':
				visit(x + read(), y);
				break;
			case 'V':
				visit(x, read());
				break;
			case 'v':
				visit(x, y + read());
				break;
			case 'Z':
			case 'z':
				x = startX;
				y = startY;
				break;
			default:
				throw new Error(`Unsupported path command ${command}`);
		}
	}

	if (!Number.isFinite(minX)) throw new Error('Path has no points');
	return { minX, minY, width: maxX - minX, height: maxY - minY };
}

export function pathViewBox(d: string, padRatio = 0.08): string {
	const box = pathBounds(d);
	const pad = Math.max(box.width, box.height, 1) * padRatio;
	const x = box.minX - pad;
	const y = box.minY - pad;
	const width = box.width + pad * 2;
	const height = box.height + pad * 2;
	const n = (value: number) => Math.round(value * 100) / 100;
	return `${n(x)} ${n(y)} ${n(width)} ${n(height)}`;
}
