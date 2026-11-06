import { describe, expect, it } from "vitest";
import { ContractError } from "../catalogue/decode";
import { parseExact, readExact } from "./lossless";

describe("lecture sans approximation silencieuse", () => {
  it("lit les entiers exactement représentables, aux bornes comprises", () => {
    expect(parseExact("[9007199254740991,-9007199254740991,0,-0,7]")).toEqual([9007199254740991, -9007199254740991, 0, -0, 7]);
  });

  it("lit les décimaux et les exposants, même longs", () => {
    expect(parseExact('{"a":0.5,"b":-1.25,"c":1e3,"d":2E-2,"e":12345678901234567890.5,"f":1e19}')).toEqual({ a: 0.5, b: -1.25, c: 1000, d: 0.02, e: 12345678901234567000, f: 1e19 });
  });

  it("refuse tout entier que le double arrondirait, avec sa raison", () => {
    for (const text of ["9007199254740993", "9007199254740992", "-9007199254740993", '{"v":[1,{"w":18446744073709551616}]}', '{"filters":[{"value":9007199254740993}]}', "10000000000000000000"]) {
      expect(() => parseExact(text), text).toThrow(ContractError);
      expect(() => parseExact(text), text).toThrow("unsafe_integer");
    }
  });

  it("ne confond pas des chiffres dans un texte avec un nombre, guillemets échappés compris", () => {
    expect(parseExact('{"a":"9007199254740993","b":"x\\"9007199254740993\\"","9007199254740993":1}')).toEqual({ a: "9007199254740993", b: 'x"9007199254740993"', "9007199254740993": 1 });
  });

  it("laisse JSON.parse refuser un texte qui n'est pas du JSON", () => {
    expect(() => parseExact("{")).toThrow(SyntaxError);
  });

  it("lit le corps d'une réponse", async () => {
    expect(await readExact(new Response('{"a":1}'))).toEqual({ a: 1 });
    await expect(readExact(new Response('{"a":9007199254740993}'))).rejects.toThrow("unsafe_integer");
  });
});
