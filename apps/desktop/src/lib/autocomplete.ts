// Schema-aware autocomplete (Decision #12 / §18).
//
// A CodeMirror completion source backed by the introspected CompletionModel.
// It parses the current statement to resolve FROM/JOIN tables and their aliases,
// then ranks suggestions: in-scope columns > tables > schemas > functions >
// keywords. Pure + synchronous so it stays snappy on large schemas.
import type { CompletionContext, CompletionResult, Completion } from "@codemirror/autocomplete";
import type { CompletionModel, RelationColumns } from "@/lib/api";

const KEYWORDS = [
  "select", "from", "where", "group by", "order by", "having", "limit", "offset",
  "insert into", "update", "delete from", "values", "set", "join", "left join",
  "inner join", "on", "as", "and", "or", "not", "null", "is null", "is not null",
  "distinct", "count", "sum", "avg", "min", "max", "case", "when", "then", "else",
  "end", "returning", "with", "union", "between", "like", "ilike", "in", "exists",
];

interface ScopeRef {
  schema: string;
  name: string;
}

/** Index relations by lowercased name and by schema.name for fast lookup. */
function indexRelations(model: CompletionModel) {
  const byName = new Map<string, RelationColumns[]>();
  const byQualified = new Map<string, RelationColumns>();
  for (const r of model.relations) {
    const list = byName.get(r.name.toLowerCase()) ?? [];
    list.push(r);
    byName.set(r.name.toLowerCase(), list);
    byQualified.set(`${r.schema}.${r.name}`.toLowerCase(), r);
  }
  return { byName, byQualified };
}

/** Find table references + aliases in the statement around the cursor. */
function resolveScope(
  stmt: string,
  index: ReturnType<typeof indexRelations>,
): { aliases: Map<string, ScopeRef>; tables: ScopeRef[] } {
  const aliases = new Map<string, ScopeRef>();
  const tables: ScopeRef[] = [];
  // Match `from|join <schema.>table [as] alias` — alias is optional.
  const re = /\b(?:from|join)\s+("?[\w]+"?)(?:\.("?[\w]+"?))?(?:\s+(?:as\s+)?("?[\w]+"?))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stmt)) !== null) {
    const unq = (s: string | undefined) => s?.replace(/"/g, "").toLowerCase();
    const first = unq(m[1]);
    const second = unq(m[2]);
    const aliasTok = unq(m[3]);
    let ref: ScopeRef | undefined;
    if (first && second) {
      ref = index.byQualified.get(`${first}.${second}`)
        ? { schema: first, name: second }
        : undefined;
    } else if (first) {
      const matches = index.byName.get(first);
      if (matches && matches.length > 0) ref = { schema: matches[0].schema, name: matches[0].name };
    }
    if (!ref) continue;
    tables.push(ref);
    // The alias keyword shouldn't be a SQL keyword like "where".
    if (aliasTok && !KEYWORDS.includes(aliasTok) && aliasTok !== "where") {
      aliases.set(aliasTok, ref);
    }
    // The bare table name also resolves to itself.
    aliases.set(ref.name.toLowerCase(), ref);
  }
  return { aliases, tables };
}

function columnsOf(ref: ScopeRef, index: ReturnType<typeof indexRelations>): Completion[] {
  const rel = index.byQualified.get(`${ref.schema}.${ref.name}`.toLowerCase());
  if (!rel) return [];
  return rel.columns.map((c) => ({
    label: c.name,
    type: "property",
    detail: c.data_type,
  }));
}

export function makeSqlCompletionSource(model: CompletionModel | null) {
  return (context: CompletionContext): CompletionResult | null => {
    if (!model) return null;
    const word = context.matchBefore(/[\w".]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    const index = indexRelations(model);
    // Current statement = text from the last ';' up to the cursor.
    const fullBefore = context.state.sliceDoc(0, context.pos);
    const stmt = fullBefore.slice(fullBefore.lastIndexOf(";") + 1);
    const { aliases, tables } = resolveScope(stmt, index);

    const token = word.text;
    const dot = token.lastIndexOf(".");

    // Qualified: `alias.` / `table.` / `schema.` → columns or tables.
    if (dot >= 0) {
      const prefix = token.slice(0, dot).replace(/"/g, "").toLowerCase();
      const ref = aliases.get(prefix);
      let options: Completion[] = [];
      if (ref) {
        options = columnsOf(ref, index);
      } else if (model.schemas.map((s) => s.toLowerCase()).includes(prefix)) {
        options = model.relations
          .filter((r) => r.schema.toLowerCase() === prefix)
          .map((r) => ({ label: r.name, type: "type", detail: r.kind }));
      }
      return { from: word.from + dot + 1, options, validFor: /^[\w]*$/ };
    }

    // Unqualified: in-scope columns (boosted) > tables > schemas > functions > keywords.
    const options: Completion[] = [];
    const seenCol = new Set<string>();
    for (const t of tables) {
      for (const c of columnsOf(t, index)) {
        if (seenCol.has(c.label)) continue;
        seenCol.add(c.label);
        options.push({ ...c, boost: 50, detail: `${t.name}.${c.label}` });
      }
    }
    for (const r of model.relations) {
      options.push({ label: r.name, type: "type", detail: `${r.schema} ${r.kind}`, boost: 10 });
    }
    for (const s of model.schemas) {
      options.push({ label: s, type: "namespace", boost: 5 });
    }
    for (const f of model.functions) {
      options.push({ label: f, type: "function", boost: -5 });
    }
    for (const k of KEYWORDS) {
      options.push({ label: k, type: "keyword", boost: -10 });
    }
    return { from: word.from, options, validFor: /^[\w]*$/ };
  };
}
