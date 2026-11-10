// Orton pyrometric cones, regular cones at a 60 °C (108 °F) per hour heating rate.

export type ConeNumber =
  | '010' | '09' | '08' | '07' | '06' | '05.5' | '05' | '04' | '03' | '02' | '01'
  | '1' | '2' | '3' | '4' | '5' | '5.5' | '6' | '7' | '8' | '9' | '10' | '11' | '12';

export interface ConeData {
  cone: ConeNumber;
  fahrenheit: number;
  celsius: number;
}

export const CONE_DATA: ConeData[] = [
  { cone: '010', fahrenheit: 1657, celsius: 903 },
  { cone: '09', fahrenheit: 1688, celsius: 920 },
  { cone: '08', fahrenheit: 1728, celsius: 942 },
  { cone: '07', fahrenheit: 1789, celsius: 976 },
  { cone: '06', fahrenheit: 1828, celsius: 998 },
  { cone: '05.5', fahrenheit: 1859, celsius: 1015 },
  { cone: '05', fahrenheit: 1888, celsius: 1031 },
  { cone: '04', fahrenheit: 1945, celsius: 1063 },
  { cone: '03', fahrenheit: 1987, celsius: 1086 },
  { cone: '02', fahrenheit: 2016, celsius: 1102 },
  { cone: '01', fahrenheit: 2046, celsius: 1119 },
  { cone: '1', fahrenheit: 2079, celsius: 1137 },
  { cone: '2', fahrenheit: 2088, celsius: 1142 },
  { cone: '3', fahrenheit: 2106, celsius: 1152 },
  { cone: '4', fahrenheit: 2124, celsius: 1162 },
  { cone: '5', fahrenheit: 2167, celsius: 1186 },
  { cone: '5.5', fahrenheit: 2197, celsius: 1203 },
  { cone: '6', fahrenheit: 2232, celsius: 1222 },
  { cone: '7', fahrenheit: 2262, celsius: 1239 },
  { cone: '8', fahrenheit: 2280, celsius: 1249 },
  { cone: '9', fahrenheit: 2300, celsius: 1260 },
  { cone: '10', fahrenheit: 2345, celsius: 1285 },
  { cone: '11', fahrenheit: 2361, celsius: 1294 },
  { cone: '12', fahrenheit: 2383, celsius: 1306 },
];

export function getConeData(cone: string): ConeData | undefined {
  return CONE_DATA.find((data) => data.cone === cone);
}

function closest(value: number, pick: (data: ConeData) => number): ConeData {
  return CONE_DATA.reduce((best, data) => (Math.abs(value - pick(data)) < Math.abs(value - pick(best)) ? data : best));
}

export const findClosestConeByFahrenheit = (fahrenheit: number) => closest(fahrenheit, (d) => d.fahrenheit);
export const findClosestConeByCelsius = (celsius: number) => closest(celsius, (d) => d.celsius);

/**
 * Cones written with a leading zero sit below cone 1. The API takes numbers, so "06" travels
 * as -6 and "05.5" as -5.5.
 */
export function coneToNumber(cone: string): number {
  return cone.startsWith('0') ? -Number(cone.slice(1)) : Number(cone);
}

export function coneFromNumber(value: number): string {
  return value < 0 ? `0${-value}` : String(value);
}
