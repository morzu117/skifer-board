import { ContractError } from "../catalogue/decode";

/**
 * Lecture d'une réponse sans approximation silencieuse (plan 18, 18.4). `JSON.parse` lit tout nombre
 * en double : un entier au-delà de 2^53 - 1 y est arrondi avant que le moindre décodeur le voie
 * (`9007199254740993` devient `9007199254740992`). Le texte source est donc balayé après la lecture :
 * tout littéral entier (sans partie fractionnaire ni exposant) que le double ne porte pas exactement
 * fait refuser le document entier, avec sa raison, au lieu de l'afficher arrondi. Le balayage saute les
 * chaînes, où des chiffres ne sont pas des nombres. La méthode ne dépend ni du `reviver` à texte source
 * (absent de certains navigateurs) ni d'une bibliothèque.
 */
const TOKEN = /"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/g;

export function parseExact(text: string): unknown {
  const value: unknown = JSON.parse(text);
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    if (token.startsWith('"') || match[1] !== undefined || match[2] !== undefined) continue;
    if (!Number.isSafeInteger(Number(token))) throw new ContractError("unsafe_integer : entier non représentable exactement");
  }
  return value;
}

export async function readExact(response: Response): Promise<unknown> {
  return parseExact(await response.text());
}
