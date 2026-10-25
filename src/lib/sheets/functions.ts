import type { HFModule } from "./engine";

// Functions HyperFormula doesn't ship that real workbooks use: Excel 2019+ text functions, Google
// Sheets' regex and JOIN, and a few classics. Without them an imported file shows #NAME?.

type Scalar = number | string | boolean | null | undefined | { value?: unknown; type?: unknown };

const text = (v: Scalar): string => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "number" ? String(parseFloat(v.toPrecision(15))) : String(v));
const num = (v: Scalar) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);

/** A criterion like ">=5", "<>done", "a*", or a plain value, as SUMIFS reads them. */
function matcher(crit: Scalar): (v: Scalar) => boolean {
  if (typeof crit === "number" || typeof crit === "boolean") return (v) => v === crit || num(v) === crit;
  const s = text(crit);
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(s)!;
  const op = m[1] ?? "=";
  const rhs = m[2];
  const n = rhs.trim() !== "" && !Number.isNaN(Number(rhs)) ? Number(rhs) : null;
  if (n !== null && op !== "=" && op !== "<>") {
    return (v) => {
      const x = num(v);
      if (x === null) return false;
      return op === "<" ? x < n : op === ">" ? x > n : op === "<=" ? x <= n : x >= n;
    };
  }
  // Wildcards: * any run, ? one character, ~ escapes either.
  let pattern = "";
  for (let i = 0; i < rhs.length; i++) {
    const ch = rhs[i];
    if (ch === "~" && (rhs[i + 1] === "*" || rhs[i + 1] === "?")) pattern += `\\${rhs[++i]}`;
    else if (ch === "*") pattern += ".*";
    else if (ch === "?") pattern += ".";
    else pattern += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const re = new RegExp(`^${pattern}$`, "i");
  const eq = (v: Scalar) => (n !== null && num(v) !== null ? num(v) === n : rhs === "" ? text(v) === "" : re.test(text(v)));
  return op === "<>" ? (v) => !eq(v) : eq;
}

export function registerFunctions(hf: HFModule) {
  const { FunctionPlugin, FunctionArgumentType: T, HyperFormula, CellError, ErrorType } = hf;
  if (HyperFormula.getRegisteredFunctionNames("enGB").includes("CONCAT")) return;
  const na = () => new CellError(ErrorType.NA);
  const value = () => new CellError(ErrorType.VALUE);
  type Range = { data: unknown[][] } & { valuesFromTopLeftCorner?: () => unknown[] };
  const flat = (r: unknown): Scalar[] => {
    const rr = r as Range;
    if (rr && typeof rr === "object" && "data" in rr) return rr.data.flat() as Scalar[];
    return [r as Scalar];
  };

  class Extra extends FunctionPlugin {
    static implementedFunctions = {
      CONCAT: { method: "concat", parameters: [{ argumentType: T.ANY }], repeatLastArgs: 1, expandRanges: true },
      JOIN: { method: "join", parameters: [{ argumentType: T.STRING }, { argumentType: T.ANY }], repeatLastArgs: 1, expandRanges: true },
      TEXTBEFORE: { method: "textbefore", parameters: [{ argumentType: T.STRING }, { argumentType: T.STRING }, { argumentType: T.NUMBER, defaultValue: 1 }] },
      TEXTAFTER: { method: "textafter", parameters: [{ argumentType: T.STRING }, { argumentType: T.STRING }, { argumentType: T.NUMBER, defaultValue: 1 }] },
      REGEXMATCH: { method: "regexmatch", parameters: [{ argumentType: T.STRING }, { argumentType: T.STRING }] },
      REGEXEXTRACT: { method: "regexextract", parameters: [{ argumentType: T.STRING }, { argumentType: T.STRING }] },
      REGEXREPLACE: { method: "regexreplace", parameters: [{ argumentType: T.STRING }, { argumentType: T.STRING }, { argumentType: T.STRING }] },
      MODE: { method: "mode", parameters: [{ argumentType: T.ANY }], repeatLastArgs: 1, expandRanges: true },
      RANK: { method: "rank", parameters: [{ argumentType: T.NUMBER }, { argumentType: T.RANGE }, { argumentType: T.NUMBER, defaultValue: 0 }] },
      "RANK.EQ": { method: "rank", parameters: [{ argumentType: T.NUMBER }, { argumentType: T.RANGE }, { argumentType: T.NUMBER, defaultValue: 0 }] },
      XMATCH: { method: "xmatch", parameters: [{ argumentType: T.NOERROR }, { argumentType: T.RANGE }, { argumentType: T.NUMBER, defaultValue: 0 }, { argumentType: T.NUMBER, defaultValue: 1 }] },
      AVERAGEIFS: { method: "averageifs", parameters: [{ argumentType: T.RANGE }, { argumentType: T.RANGE }, { argumentType: T.NOERROR }], repeatLastArgs: 2 },
    };

    concat(ast: never, state: never) {
      return this.runFunction((ast as { args: never }).args, state, this.metadata("CONCAT"), (...args: Scalar[]) => args.map(text).join(""));
    }
    join(ast: never, state: never) {
      return this.runFunction((ast as { args: never }).args, state, this.metadata("JOIN"), (delim: string, ...args: Scalar[]) => args.map(text).join(delim));
    }
    textbefore(ast: never, state: never) {
      return this.runFunction((ast as { args: never }).args, state, this.metadata("TEXTBEFORE"), (s: string, d: string, n: number) => {
        const parts = s.split(d);
        if (!d || n === 0 || Math.abs(n) >= parts.length) return na();
        return n > 0 ? parts.slice(0, n).join(d) : parts.slice(0, parts.length + n).join(d);
      });
    }
    textafter(ast: never, state: never) {
      return this.runFunction((ast as { args: never }).args, state, this.metadata("TEXTAFTER"), (s: string, d: string, n: number) => {
        const parts = s.split(d);
        if (!d || n === 0 || Math.abs(n) >= parts.length) return na();
        return n > 0 ? parts.slice(n).join(d) : parts.slice(parts.length + n).join(d);
      });
    }
    regexmatch(ast: never, state: never) {
      return this.runFunction((ast as { args: never }).args, state, this.metadata("REGEXMATCH"), (s: string, re: string) => {
        try {
          return new RegExp(re).test(s);
        } catch {
          return value();
        }
      });
    }
    regexextract(ast: never, state: never) {
      return this.runFunction((ast as { args: never }).args, state, this.metadata("REGEXEXTRACT"), (s: string, re: string) => {
        try {
          const m = new RegExp(re).exec(s);
          return m ? (m[1] ?? m[0]) : na();
        } catch {
          return value();
        }
      });
    }
    regexreplace(ast: never, state: never) {
      return this.runFunction((ast as { args: never }).args, state, this.metadata("REGEXREPLACE"), (s: string, re: string, by: string) => {
        try {
          return s.replace(new RegExp(re, "g"), by);
        } catch {
          return value();
        }
      });
    }
    mode(ast: never, state: never) {
      return this.runFunction((ast as { args: never }).args, state, this.metadata("MODE"), (...args: Scalar[]) => {
        const counts = new Map<number, number>();
        let best: number | null = null;
        for (const v of args) {
          if (typeof v !== "number") continue;
          const c = (counts.get(v) ?? 0) + 1;
          counts.set(v, c);
          if (c > 1 && (best === null || c > counts.get(best)!)) best = v;
        }
        return best ?? na();
      });
    }
    rank(ast: never, state: never) {
      const meta = this.metadata((ast as { procedureName: string }).procedureName) ?? this.metadata("RANK");
      return this.runFunction((ast as { args: never }).args, state, meta, (n: number, range: unknown, order: number) => {
        const nums = flat(range).filter((v): v is number => typeof v === "number");
        if (!nums.includes(n)) return na();
        return 1 + nums.filter((x) => (order ? x < n : x > n)).length;
      });
    }
    xmatch(ast: never, state: never) {
      return this.runFunction((ast as { args: never }).args, state, this.metadata("XMATCH"), (needle: Scalar, range: unknown, mode: number, search: number) => {
        const list = flat(range);
        const idx = search < 0 ? [...list.keys()].reverse() : [...list.keys()];
        const eq = mode === 2 ? matcher(needle) : (v: Scalar) => (typeof needle === "string" && typeof v === "string" ? v.toLowerCase() === needle.toLowerCase() : v === needle);
        for (const i of idx) if (eq(list[i])) return i + 1;
        if (mode === -1 || mode === 1) {
          // Next smaller (-1) or next larger (1) when there is no exact match.
          let pick = -1;
          for (const i of idx) {
            const v = list[i];
            if (typeof v !== "number" || typeof needle !== "number") continue;
            if (mode === -1 ? v < needle && (pick < 0 || v > (list[pick] as number)) : v > needle && (pick < 0 || v < (list[pick] as number))) pick = i;
          }
          if (pick >= 0) return pick + 1;
        }
        return na();
      });
    }
    averageifs(ast: never, state: never) {
      return this.runFunction((ast as { args: never }).args, state, this.metadata("AVERAGEIFS"), (avg: unknown, ...rest: unknown[]) => {
        const values = flat(avg);
        const tests: { cells: Scalar[]; ok: (v: Scalar) => boolean }[] = [];
        for (let i = 0; i < rest.length; i += 2) {
          const cells = flat(rest[i]);
          if (cells.length !== values.length) return value();
          tests.push({ cells, ok: matcher(rest[i + 1] as Scalar) });
        }
        let sum = 0;
        let n = 0;
        values.forEach((v, i) => {
          if (typeof v === "number" && tests.every((t) => t.ok(t.cells[i]))) {
            sum += v;
            n++;
          }
        });
        return n ? sum / n : new CellError(ErrorType.DIV_BY_ZERO);
      });
    }
  }

  const names = Object.keys(Extra.implementedFunctions);
  const translations = Object.fromEntries(HyperFormula.getRegisteredLanguagesCodes().map((code) => [code, Object.fromEntries(names.map((n) => [n, n]))]));
  HyperFormula.registerFunctionPlugin(Extra as never, translations);
}
