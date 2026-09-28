export interface StateRow {
	code: string;
	name: string;
	fips: string;
	houseSeats: number;
}

export const states: StateRow[] = [
	{ code: 'al', name: 'Alabama', fips: '01', houseSeats: 7 },
	{ code: 'ak', name: 'Alaska', fips: '02', houseSeats: 1 },
	{ code: 'az', name: 'Arizona', fips: '04', houseSeats: 9 },
	{ code: 'ar', name: 'Arkansas', fips: '05', houseSeats: 4 },
	{ code: 'ca', name: 'California', fips: '06', houseSeats: 52 },
	{ code: 'co', name: 'Colorado', fips: '08', houseSeats: 8 },
	{ code: 'ct', name: 'Connecticut', fips: '09', houseSeats: 5 },
	{ code: 'de', name: 'Delaware', fips: '10', houseSeats: 1 },
	{ code: 'fl', name: 'Florida', fips: '12', houseSeats: 28 },
	{ code: 'ga', name: 'Georgia', fips: '13', houseSeats: 14 },
	{ code: 'hi', name: 'Hawaii', fips: '15', houseSeats: 2 },
	{ code: 'id', name: 'Idaho', fips: '16', houseSeats: 2 },
	{ code: 'il', name: 'Illinois', fips: '17', houseSeats: 17 },
	{ code: 'in', name: 'Indiana', fips: '18', houseSeats: 9 },
	{ code: 'ia', name: 'Iowa', fips: '19', houseSeats: 4 },
	{ code: 'ks', name: 'Kansas', fips: '20', houseSeats: 4 },
	{ code: 'ky', name: 'Kentucky', fips: '21', houseSeats: 6 },
	{ code: 'la', name: 'Louisiana', fips: '22', houseSeats: 6 },
	{ code: 'me', name: 'Maine', fips: '23', houseSeats: 2 },
	{ code: 'md', name: 'Maryland', fips: '24', houseSeats: 8 },
	{ code: 'ma', name: 'Massachusetts', fips: '25', houseSeats: 9 },
	{ code: 'mi', name: 'Michigan', fips: '26', houseSeats: 13 },
	{ code: 'mn', name: 'Minnesota', fips: '27', houseSeats: 8 },
	{ code: 'ms', name: 'Mississippi', fips: '28', houseSeats: 4 },
	{ code: 'mo', name: 'Missouri', fips: '29', houseSeats: 8 },
	{ code: 'mt', name: 'Montana', fips: '30', houseSeats: 2 },
	{ code: 'ne', name: 'Nebraska', fips: '31', houseSeats: 3 },
	{ code: 'nv', name: 'Nevada', fips: '32', houseSeats: 4 },
	{ code: 'nh', name: 'New Hampshire', fips: '33', houseSeats: 2 },
	{ code: 'nj', name: 'New Jersey', fips: '34', houseSeats: 12 },
	{ code: 'nm', name: 'New Mexico', fips: '35', houseSeats: 3 },
	{ code: 'ny', name: 'New York', fips: '36', houseSeats: 26 },
	{ code: 'nc', name: 'North Carolina', fips: '37', houseSeats: 14 },
	{ code: 'nd', name: 'North Dakota', fips: '38', houseSeats: 1 },
	{ code: 'oh', name: 'Ohio', fips: '39', houseSeats: 15 },
	{ code: 'ok', name: 'Oklahoma', fips: '40', houseSeats: 5 },
	{ code: 'or', name: 'Oregon', fips: '41', houseSeats: 6 },
	{ code: 'pa', name: 'Pennsylvania', fips: '42', houseSeats: 17 },
	{ code: 'ri', name: 'Rhode Island', fips: '44', houseSeats: 2 },
	{ code: 'sc', name: 'South Carolina', fips: '45', houseSeats: 7 },
	{ code: 'sd', name: 'South Dakota', fips: '46', houseSeats: 1 },
	{ code: 'tn', name: 'Tennessee', fips: '47', houseSeats: 9 },
	{ code: 'tx', name: 'Texas', fips: '48', houseSeats: 38 },
	{ code: 'ut', name: 'Utah', fips: '49', houseSeats: 4 },
	{ code: 'vt', name: 'Vermont', fips: '50', houseSeats: 1 },
	{ code: 'va', name: 'Virginia', fips: '51', houseSeats: 11 },
	{ code: 'wa', name: 'Washington', fips: '53', houseSeats: 10 },
	{ code: 'wv', name: 'West Virginia', fips: '54', houseSeats: 2 },
	{ code: 'wi', name: 'Wisconsin', fips: '55', houseSeats: 8 },
	{ code: 'wy', name: 'Wyoming', fips: '56', houseSeats: 1 },
];

export function stateByCode(code: string): StateRow | undefined {
	return states.find((state) => state.code === code);
}
