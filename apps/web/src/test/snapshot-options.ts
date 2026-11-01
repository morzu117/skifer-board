/** Chaque fonction doit avoir des témoins explicites : une nouvelle fonction non couverte échoue. */
export function sampleFunctions(value: unknown, witnesses: Readonly<Record<string, readonly unknown[][]>>, path = "option"): unknown {
  if (typeof value === "function") {
    const inputs = witnesses[path];
    if (inputs === undefined) throw new Error(`Fonction sans valeurs témoins : ${path}`);
    const callback = value as (...args: unknown[]) => unknown;
    return inputs.map((args) => ({ arguments: args, résultat: sampleFunctions(callback(...args), witnesses, `${path}.résultat`) }));
  }
  if (Array.isArray(value)) return value.map((item: unknown, index) => sampleFunctions(item, witnesses, `${path}.${index}`));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]: [string, unknown]) => [key, sampleFunctions(item, witnesses, `${path}.${key}`)]));
  }
  return value;
}

export const amountWitnesses = [0, 830, 412_000, 999_500, 16_500_000, -180_000, 1_200_000_000].map((value) => [value]);
export const categoryWitnesses = ["Île-de-France", "Auvergne-Rhône-Alpes", "Provence-Alpes-Côte d'Azur", "janv. 26"].map((value) => [value]);
