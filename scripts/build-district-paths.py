#!/usr/bin/env python3
"""Build src/data/district-paths.ts from Census congressional district polygons.

The 2026 TIGER legislative GeoPackage is the 120th Congress, which is the map
used for the 2026 election. Ten states submitted new plans: Alabama, California,
Florida, Louisiana, Missouri, North Carolina, Ohio, Tennessee, Texas, and Utah.
The 2025 cartographic file (cb_2025_us_cd119_500k) is the previous Congress.

Download tlgpkg_2026_us_legislative.gpkg.zip from
https://www2.census.gov/geo/tiger/TGRGPKG26/tlgpkg_2026_us_legislative.gpkg.zip
and pass the zip or the extracted .gpkg as the first argument.
A cb_*_us_cd*_500k.zip shapefile still works.
"""

import re
import sqlite3
import struct
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATES_TS = ROOT / "src/data/states.ts"
OUT = ROOT / "src/data/district-paths.ts"
WIDTH = 1000.0
TOLERANCE = 0.55


def states_by_fips() -> dict[str, tuple[str, int]]:
	text = STATES_TS.read_text()
	rows = re.findall(
		r"\{\s*code:\s*'([a-z]{2})'.*?fips:\s*'(\d{2})'.*?houseSeats:\s*(\d+)",
		text,
	)
	if len(rows) != 50:
		raise SystemExit(f"Expected 50 states in states.ts, found {len(rows)}")
	return {fips: (code, int(seats)) for code, fips, seats in rows}


def read_dbf(data: bytes) -> list[dict[str, str]]:
	nrec, hlen, rlen = struct.unpack("<IHH", data[4:12])
	pos = 32
	fields: list[tuple[str, int]] = []
	while data[pos] != 0x0D:
		name = data[pos : pos + 11].split(b"\x00", 1)[0].decode()
		fields.append((name, data[pos + 16]))
		pos += 32
	pos = hlen
	rows: list[dict[str, str]] = []
	for _ in range(nrec):
		rec = data[pos : pos + rlen]
		pos += rlen
		if rec[:1] == b"*":
			rows.append({})
			continue
		offset = 1
		row: dict[str, str] = {}
		for name, length in fields:
			row[name] = rec[offset : offset + length].decode("latin1").strip()
			offset += length
		rows.append(row)
	return rows


def parse_wkb_rings(wkb: bytes) -> list[list[tuple[float, float]]]:
	def parse(buf: bytes, pos: int) -> tuple[list[list[tuple[float, float]]], int]:
		order = "<" if buf[pos] == 1 else ">"
		pos += 1
		geom_type = struct.unpack_from(order + "I", buf, pos)[0]
		pos += 4
		base = geom_type % 1000
		has_z = geom_type >= 1000 and (geom_type // 1000) % 10 in (1, 3)
		dims = 3 if has_z else 2
		if base == 6:
			count = struct.unpack_from(order + "I", buf, pos)[0]
			pos += 4
			rings: list[list[tuple[float, float]]] = []
			for _ in range(count):
				part, pos = parse(buf, pos)
				rings.extend(part)
			return rings, pos
		if base != 3:
			raise SystemExit(f"Unexpected WKB type {geom_type}")
		ring_count = struct.unpack_from(order + "I", buf, pos)[0]
		pos += 4
		rings = []
		for _ in range(ring_count):
			point_count = struct.unpack_from(order + "I", buf, pos)[0]
			pos += 4
			points = []
			for _ in range(point_count):
				lon, lat = struct.unpack_from(order + "dd", buf, pos)
				points.append((lon, lat))
				pos += 8 * dims
			rings.append(points)
		return rings, pos

	rings, _pos = parse(wkb, 0)
	return rings


def gpkg_wkb(blob: bytes) -> bytes:
	if blob[:2] != b"GP":
		raise SystemExit("Not a GeoPackage geometry blob")
	flags = blob[3]
	envelope = (flags >> 1) & 0b111
	sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
	if envelope not in sizes:
		raise SystemExit(f"Unexpected GeoPackage envelope {envelope}")
	return blob[8 + sizes[envelope] :]


def read_gpkg(path: Path) -> list[tuple[dict[str, str], list[list[tuple[float, float]]]]]:
	con = sqlite3.connect(path)
	tables = [row[0] for row in con.execute("SELECT table_name FROM gpkg_contents")]
	table = next(name for name in tables if "Congressional" in name)
	columns = [row[1] for row in con.execute(f'PRAGMA table_info("{table}")')]
	cd_col = next(name for name in columns if name.startswith("CD") and name.endswith("FP"))
	state_col = "STATEFP"
	rows = []
	for statefp, cd, blob in con.execute(f'SELECT {state_col}, {cd_col}, shape FROM "{table}"'):
		if blob is None:
			continue
		rows.append(({"STATEFP": statefp, cd_col: cd}, parse_wkb_rings(gpkg_wkb(blob))))
	con.close()
	return rows


def read_shp(data: bytes) -> list[list[list[tuple[float, float]]] | None]:
	pos = 100
	shapes: list[list[list[tuple[float, float]]] | None] = []
	while pos + 8 <= len(data):
		_rec, words = struct.unpack(">ii", data[pos : pos + 8])
		pos += 8
		content = data[pos : pos + words * 2]
		pos += words * 2
		if len(content) < 4:
			shapes.append(None)
			continue
		shape_type = struct.unpack("<i", content[:4])[0]
		if shape_type == 0:
			shapes.append(None)
			continue
		if shape_type != 5:
			raise SystemExit(f"Unexpected shape type {shape_type}")
		num_parts, num_points = struct.unpack("<ii", content[36:44])
		parts = struct.unpack(f"<{num_parts}i", content[44 : 44 + 4 * num_parts])
		point_at = 44 + 4 * num_parts
		points = [
			struct.unpack("<dd", content[point_at + i * 16 : point_at + (i + 1) * 16])
			for i in range(num_points)
		]
		rings = []
		for index, start in enumerate(parts):
			end = parts[index + 1] if index + 1 < len(parts) else num_points
			rings.append(points[start:end])
		shapes.append(rings)
	return shapes


def unwrap(rings: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
	lons = [lon for ring in rings for lon, _lat in ring]
	if not lons or max(lons) - min(lons) <= 180:
		return rings
	return [[((lon + 360) if lon < 0 else lon, lat) for lon, lat in ring] for ring in rings]


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
	count = len(points)
	if count < 3:
		return points
	keep = [False] * count
	keep[0] = keep[-1] = True
	limit = tolerance * tolerance
	stack = [(0, count - 1)]
	while stack:
		start, end = stack.pop()
		ax, ay = points[start]
		bx, by = points[end]
		dx, dy = bx - ax, by - ay
		denom = dx * dx + dy * dy
		farthest = 0.0
		index = -1
		for i in range(start + 1, end):
			px, py = points[i]
			if denom == 0:
				dist = (px - ax) ** 2 + (py - ay) ** 2
			else:
				t = ((px - ax) * dx + (py - ay) * dy) / denom
				if t < 0:
					t = 0.0
				elif t > 1:
					t = 1.0
				qx, qy = ax + t * dx, ay + t * dy
				dist = (px - qx) ** 2 + (py - qy) ** 2
			if dist > farthest:
				farthest = dist
				index = i
		if index != -1 and farthest > limit:
			keep[index] = True
			stack.append((start, index))
			stack.append((index, end))
	return [points[i] for i in range(count) if keep[i]]


def ring_path(ring: list[tuple[float, float]]) -> str:
	if len(ring) < 4:
		return ""
	def num(value: float) -> str:
		text = f"{value:.1f}"
		if text == "-0.0":
			return "0.0"
		return text

	head = f"M {num(ring[0][0])} {num(ring[0][1])}"
	rest = " ".join(f"{num(x)} {num(y)}" for x, y in ring[1:-1])
	if not rest:
		return ""
	return f"{head} L {rest} Z"


def load_features(source: Path) -> list[tuple[dict[str, str], list[list[tuple[float, float]]]]]:
	if source.suffix == ".gpkg":
		return read_gpkg(source)
	if source.suffix != ".zip":
		raise SystemExit(f"Expected a .gpkg or .zip, got {source.name}")
	with zipfile.ZipFile(source) as archive:
		names = archive.namelist()
		gpkg_name = next((name for name in names if name.endswith(".gpkg")), None)
		if gpkg_name:
			with tempfile.TemporaryDirectory() as tmp:
				archive.extract(gpkg_name, tmp)
				return read_gpkg(Path(tmp) / gpkg_name)
		shp_name = next(name for name in names if name.endswith(".shp"))
		dbf_name = next(name for name in names if name.endswith(".dbf"))
		rows = read_dbf(archive.read(dbf_name))
		shapes = read_shp(archive.read(shp_name))
	if len(rows) != len(shapes):
		raise SystemExit(f"DBF rows ({len(rows)}) do not match shapes ({len(shapes)})")
	features = []
	for row, rings in zip(rows, shapes):
		if rings:
			features.append((row, rings))
	return features


def cd_code(row: dict[str, str]) -> str:
	for name, value in row.items():
		if name.startswith("CD") and name.endswith("FP"):
			return value
	raise SystemExit(f"No congressional district code in {sorted(row)}")


def main() -> None:
	if len(sys.argv) != 2:
		raise SystemExit(
			"Usage: scripts/build-district-paths.py <tlgpkg_2026_us_legislative.gpkg.zip>"
		)
	by_fips = states_by_fips()
	features = load_features(Path(sys.argv[1]))

	grouped: dict[str, dict[str, list[list[tuple[float, float]]]]] = {}
	for row, rings in features:
		fips = row.get("STATEFP", "")
		if fips not in by_fips or not rings:
			continue
		code, _seats = by_fips[fips]
		cd = cd_code(row)
		if not cd.isdigit():
			continue
		key = "at-large" if cd == "00" else str(int(cd))
		grouped.setdefault(code, {}).setdefault(key, []).extend(unwrap(rings))

	lines = [
		"// House district outlines from the Census Bureau 2026 TIGER legislative",
		"// GeoPackage for the 120th Congress (tlgpkg_2026_us_legislative). Public domain.",
		"export const districtPaths: Record<string, Record<string, string>> = {",
	]
	ordered = sorted(by_fips.values(), key=lambda item: item[0])
	for code, seats in ordered:
		districts = grouped.get(code)
		if not districts:
			raise SystemExit(f"No shapes for {code}")
		expected = ["at-large"] if seats == 1 else [str(n) for n in range(1, seats + 1)]
		if set(districts) != set(expected):
			raise SystemExit(f"{code} districts {sorted(districts)} != {expected}")

		lons = [lon for rings in districts.values() for ring in rings for lon, _lat in ring]
		lats = [lat for rings in districts.values() for ring in rings for _lon, lat in ring]
		min_lon, max_lon = min(lons), max(lons)
		min_lat, max_lat = min(lats), max(lats)
		cos = __import__("math").cos(((min_lat + max_lat) / 2) * __import__("math").pi / 180)
		span_x = max((max_lon - min_lon) * cos, 1e-6)
		scale = WIDTH / span_x

		def project(lon: float, lat: float) -> tuple[float, float]:
			return ((lon - min_lon) * cos * scale, (max_lat - lat) * scale)

		lines.append(f"\t{code}: {{")
		keys = ["at-large"] if seats == 1 else [str(n) for n in range(1, seats + 1)]
		for key in keys:
			projected = [[project(lon, lat) for lon, lat in ring] for ring in districts[key]]
			parts = []
			for ring in projected:
				if len(ring) < 4:
					continue
				closed = ring if ring[0] == ring[-1] else [*ring, ring[0]]
				simple = simplify(closed, TOLERANCE)
				if len(simple) < 4:
					continue
				if simple[0] != simple[-1]:
					simple.append(simple[0])
				part = ring_path(simple)
				if part:
					parts.append(part)
			if not parts:
				raise SystemExit(f"Empty path for {code} {key}")
			path = " ".join(parts)
			lines.append(f"\t\t{json_key(key)}: {json_string(path)},")
		lines.append("\t},")
	lines.append("};")
	lines.append("")
	OUT.write_text("\n".join(lines))
	print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


def json_key(key: str) -> str:
	return f'"{key}"'


def json_string(value: str) -> str:
	return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


if __name__ == "__main__":
	main()
