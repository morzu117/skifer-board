/**
 * Lecteur d'un sous-ensemble de YAML, pour les fixtures de `contracts/analyses/fixtures/` (le web n'a
 * pas de bibliothèque YAML et les tests n'ont pas le droit d'en ajouter une sans réseau). Il lit ce
 * que les fixtures emploient : blocs, listes, `[]` et `{}`, scalaires simples, entre guillemets et
 * `|`. Tout le reste est refusé par une erreur, jamais interprété : un fichier qui sortirait de ce
 * sous-ensemble ferait échouer les tests au lieu d'être mal lu. Une date non quotée (`2026-01-01`)
 * est lue comme une `Date`, comme le fait YAML : ce n'est pas du texte.
 */
interface Line {
  indent: number;
  text: string;
}

/** Ce que le YAML 1.1 du serveur lit comme un nombre : entiers (décimal, `0x`, `0b`, `0o`, `_`, sexagésimal), flottants, `.inf`, `.nan`. */
const NUMBER_LIKE = /^[-+]?(?:0[xbo][0-9a-f_]*|\d[\d_]*(?:\.[\d_]*)?(?:e[-+]?\d+)?|\.\d[\d_]*(?:e[-+]?\d+)?|\d[\d_]*(?::[0-5]?\d)+(?:\.[\d_]*)?|\.(?:inf|nan))$/i;

const unsupported = (what: string): never => {
  throw new Error(`YAML hors du sous-ensemble lu : ${what}`);
};

export function loadYaml(source: string): unknown {
  const lines = source.split("\n");
  let at = 0;

  const meaningful = (): Line | null => {
    while (at < lines.length) {
      const raw = lines[at] ?? "";
      const text = raw.trim();
      if (text !== "" && !text.startsWith("#")) {
        if (raw.includes("\t")) return unsupported("tabulation");
        return { indent: raw.length - raw.trimStart().length, text };
      }
      at += 1;
    }
    return null;
  };

  const scalar = (text: string): unknown => {
    if (text === "" || text === "null") return null;
    if (text === "true") return true;
    if (text === "false") return false;
    // Le lecteur du serveur (PyYAML, YAML 1.1) lit ces formes comme un booléen ou un nul : les prendre ici pour du
    // texte masquerait la vraie raison d'un refus. Elles sortent du sous-ensemble, au lieu d'être lues de travers.
    if (/^(?:~|null|true|false|y|n|yes|no|on|off)$/i.test(text)) return unsupported(`booléen ou nul ambigu ${text}`);
    if (/^[-+]?(?:0|[1-9]\d*)$/.test(text)) return Number(text);
    if (/^[-+]?(?:0|[1-9]\d*)\.\d+$/.test(text)) return Number(text);
    if (/^\d{4}-\d{2}-\d{2}(?:[Tt ].*)?$/.test(text)) return new Date(text);
    // Hexadécimal, octal, binaire, séparateurs `_`, exposants, sexagésimaux, `.inf` et `.nan` : un scalaire qui
    // commence comme un nombre sans en être un du sous-ensemble est un nombre pour le serveur, pas du texte.
    if (NUMBER_LIKE.test(text)) return unsupported(`nombre hors du sous-ensemble ${text}`);
    if (/^[&*!|>%@`{[]/.test(text) || text.includes(": ") || text.includes(" #") || text.endsWith(":")) return unsupported(`scalaire ${text}`);
    return text;
  };

  const quoted = (text: string): string => {
    if (text.startsWith("'")) {
      if (!text.endsWith("'") || text.length < 2) return unsupported(`guillemets ${text}`);
      return text.slice(1, -1).replaceAll("''", "'");
    }
    if (!text.endsWith('"') || text.length < 2) return unsupported(`guillemets ${text}`);
    return text.slice(1, -1).replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (_all, code: string) => {
      const simple: Record<string, string> = { t: "\t", n: "\n", '"': '"', "\\": "\\", "/": "/" };
      if (code.length > 1) return String.fromCharCode(parseInt(code.slice(1), 16));
      return simple[code] ?? unsupported(`échappement \\${code}`);
    });
  };

  const flow = (text: string): unknown => {
    let cursor = 0;
    const skip = () => { while (text[cursor] === " ") cursor += 1; };
    const token = (stops: string): unknown => {
      skip();
      const first = text[cursor];
      if (first === "[" || first === "{") return collection();
      if (first === '"' || first === "'") {
        const start = cursor;
        cursor += 1;
        while (cursor < text.length && !(text[cursor] === first && text[cursor - 1] !== "\\" && !(first === "'" && text[cursor + 1] === "'"))) cursor += first === "'" && text[cursor] === "'" ? 2 : 1;
        cursor += 1;
        return quoted(text.slice(start, cursor));
      }
      const start = cursor;
      while (cursor < text.length && !stops.includes(text[cursor] ?? "")) cursor += 1;
      return scalar(text.slice(start, cursor).trim());
    };
    const collection = (): unknown => {
      const open = text[cursor];
      cursor += 1;
      skip();
      if (open === "[") {
        const list: unknown[] = [];
        if (text[cursor] === "]") { cursor += 1; return list; }
        for (;;) {
          list.push(token(",]"));
          skip();
          const next = text[cursor];
          cursor += 1;
          if (next === "]") return list;
          if (next !== ",") return unsupported(`liste ${text}`);
        }
      }
      const map: Record<string, unknown> = {};
      if (text[cursor] === "}") { cursor += 1; return map; }
      for (;;) {
        const key = String(token(":"));
        skip();
        if (text[cursor] !== ":") return unsupported(`dictionnaire ${text}`);
        cursor += 1;
        if (Object.hasOwn(map, key)) return unsupported(`clé en double ${key}`);
        map[key] = token(",}");
        skip();
        const next = text[cursor];
        cursor += 1;
        if (next === "}") return map;
        if (next !== ",") return unsupported(`dictionnaire ${text}`);
      }
    };
    const value = collection();
    skip();
    return cursor === text.length ? value : unsupported(`texte après ${text}`);
  };

  const inline = (text: string): unknown => {
    if (text.startsWith('"') || text.startsWith("'")) return quoted(text);
    if (text.startsWith("[") || text.startsWith("{")) return flow(text);
    return scalar(text);
  };

  const block = (parent: number, marker: string): string => {
    if (marker !== "|" && marker !== "|-") return unsupported(`bloc ${marker}`);
    const collected: string[] = [];
    let indent = -1;
    while (at < lines.length) {
      const raw = lines[at] ?? "";
      const lead = raw.length - raw.trimStart().length;
      if (raw.trim() !== "" && lead <= parent) break;
      if (raw.trim() !== "" && indent === -1) indent = lead;
      collected.push(raw.trim() === "" ? "" : raw.slice(indent));
      at += 1;
    }
    while (collected.at(-1) === "") collected.pop();
    return collected.join("\n") + (marker === "|" ? "\n" : "");
  };

  const sequence = (indent: number): unknown[] => {
    const list: unknown[] = [];
    for (let line = meaningful(); line !== null && line.indent === indent && (line.text === "-" || line.text.startsWith("- ")); line = meaningful()) {
      const rest = line.text.slice(1).trim();
      if (rest === "") {
        at += 1;
        const next = meaningful();
        list.push(next !== null && next.indent > indent ? node(next.indent) : null);
      } else if (/^[A-Za-z_][\w-]*:(?: |$)/.test(rest)) {
        // Un élément qui est un dictionnaire : sa première clé suit le tiret, les autres sont alignées dessus.
        lines[at] = `${" ".repeat(indent + 2)}${rest}`;
        list.push(mapping(indent + 2));
      } else {
        at += 1;
        list.push(inline(rest));
      }
    }
    return list;
  };

  const mapping = (indent: number): Record<string, unknown> => {
    const map: Record<string, unknown> = {};
    for (let line = meaningful(); line !== null && line.indent === indent && !line.text.startsWith("- "); line = meaningful()) {
      const found = /^([A-Za-z_][\w-]*):(?: (.*))?$/.exec(line.text);
      if (found === null) return unsupported(`ligne ${line.text}`);
      const key = found[1] ?? "";
      if (Object.hasOwn(map, key)) return unsupported(`clé en double ${key}`);
      const rest = (found[2] ?? "").trim();
      at += 1;
      if (rest.startsWith("|") || rest.startsWith(">")) {
        map[key] = block(indent, rest);
      } else if (rest !== "") {
        map[key] = inline(rest);
      } else {
        const next = meaningful();
        const nested = next !== null && (next.indent > indent || (next.indent === indent && next.text.startsWith("- ")));
        map[key] = nested ? node(next.indent) : null;
      }
    }
    return map;
  };

  const node = (indent: number): unknown => {
    const line = meaningful();
    if (line === null) return null;
    if (line.text === "-" || line.text.startsWith("- ")) return sequence(indent);
    if (/^[A-Za-z_][\w-]*:(?: |$)/.test(line.text)) return mapping(indent);
    at += 1;
    return inline(line.text);
  };

  const first = meaningful();
  const root = first === null ? null : node(first.indent);
  return meaningful() === null ? root : unsupported("contenu après la racine");
}
