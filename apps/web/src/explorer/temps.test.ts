import { DateDay, DateMillisecond, TimestampMicrosecond, TimestampNanosecond, TimestampSecond } from "apache-arrow";
import { expect, it } from "vitest";
import { texteTemporel } from "./temps";

it.each([
  [0n, new DateDay(), "1970-01-01"], [20000n, new DateDay(), "2024-10-04"],
  [-1n, new DateDay(), "1969-12-31"], [-1n, new DateMillisecond(), "1969-12-31"],
  [0n, new TimestampSecond(), "1970-01-01T00:00:00"],
  [-1n, new TimestampMicrosecond(), "1969-12-31T23:59:59.999999"],
  [-1n, new TimestampNanosecond(), "1969-12-31T23:59:59.999999999"],
  [1700000000123457n, new TimestampMicrosecond(), "2023-11-14T22:13:20.123457"],
  [0n, new TimestampSecond("UTC"), "1970-01-01T00:00:00Z"],
  [1700000000123457n, new TimestampMicrosecond("America/New_York"), "2023-11-14T22:13:20.123457Z"],
  [2932897n, new DateDay(), "+010000-01-01"],
])("formate l'époque entière %s exactement", (valeur, type, attendu) => {
  expect(texteTemporel(valeur, type)).toBe(attendu);
});

it("garde les années étendues de part et d'autre de l'an zéro", () => {
  expect(texteTemporel(-719529n, new DateDay())).toBe("-000001-12-31");
  expect(texteTemporel(-719528n, new DateDay())).toBe("0000-01-01");
});
