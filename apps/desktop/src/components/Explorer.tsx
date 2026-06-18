import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Table2, Eye, Boxes, RefreshCw } from "lucide-react";
import { api, type RelationInfo, type SchemaInfo } from "@/lib/api";
import { useStore } from "@/store";
import { useActionFeedback } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { ErrorTimer, sectionLabelCls } from "@/components/ui";

const TABLE_KINDS = ["r", "p"];
const VIEW_KINDS = ["v", "m"];
const ALL_KINDS = [...TABLE_KINDS, ...VIEW_KINDS];

export function Explorer() {
  const session = useStore((s) => s.session);
  const setQuery = useStore((s) => s.setQuery);
  const requestRun = useStore((s) => s.requestRun);
  const openTable = useStore((s) => s.openTable);
  const showQuery = useStore((s) => s.showQuery);
  const schemaVersion = useStore((s) => s.schemaVersion);
  const { fail, isFlashing } = useActionFeedback();

  const [schemas, setSchemas] = useState<SchemaInfo[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [rels, setRels] = useState<Record<string, RelationInfo[]>>({});
  const [busy, setBusy] = useState(false);

  // Mirror the relation cache so refresh can re-fetch the already-loaded schemas
  // without re-running on every cache write.
  const relsRef = useRef(rels);
  relsRef.current = rels;

  // Initial load + full reset when the session changes.
  useEffect(() => {
    if (!session) {
      setSchemas([]);
      setRels({});
      setExpanded({});
      return;
    }
    api
      .schemaList(session.sessionId)
      .then(setSchemas)
      .catch((e) => fail(e, { title: "Couldn't load schemas" }));
  }, [session, fail]);

  // Re-introspect schemas and every already-loaded relation list, preserving
  // expansion state. Driven by the refresh button and by query execution.
  const refresh = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      setSchemas(await api.schemaList(session.sessionId));
      const loaded = Object.keys(relsRef.current);
      const pairs = await Promise.all(
        loaded.map(
          async (schema) =>
            [schema, await api.relationList(session.sessionId, schema, ALL_KINDS)] as const,
        ),
      );
      setRels((prev) => {
        const next = { ...prev };
        for (const [schema, all] of pairs) next[schema] = all;
        return next;
      });
    } catch (e) {
      fail(e, { key: "refresh", title: "Couldn't refresh schema" });
    } finally {
      setBusy(false);
    }
  }, [session, fail]);

  // A successful query bumps schemaVersion; mirror any DDL into the tree.
  useEffect(() => {
    if (schemaVersion > 0) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaVersion]);

  const toggle = useCallback(
    async (schema: string) => {
      setExpanded((e) => ({ ...e, [schema]: !e[schema] }));
      if (!rels[schema] && session) {
        try {
          const all = await api.relationList(session.sessionId, schema, ALL_KINDS);
          setRels((r) => ({ ...r, [schema]: all }));
        } catch (e) {
          fail(e, { key: schema, title: `Couldn't load ${schema}` });
        }
      }
    },
    [rels, session, fail],
  );

  // Single click → open the editable data grid; double click → SELECT into the
  // query editor and run it.
  function openRelation(rel: RelationInfo, asQuery: boolean) {
    if (asQuery) {
      setQuery(`SELECT * FROM "${rel.schema}"."${rel.name}" LIMIT 100;`);
      showQuery();
      requestRun();
    } else {
      openTable(rel.schema, rel.name);
    }
  }

  if (!session) {
    return <p className="px-1 text-xs text-muted">Connect to a server to browse its objects.</p>;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-1.5 pr-1">
        <p className={sectionLabelCls}>{session.name}</p>
        <button
          onClick={() => void refresh()}
          disabled={busy}
          aria-disabled={isFlashing("refresh") || undefined}
          title="Refresh schema"
          className={cn(
            "relative shrink-0 overflow-hidden p-1 text-muted/70 transition-colors hover:text-ink disabled:opacity-50",
            isFlashing("refresh") && "pointer-events-none",
          )}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
          {isFlashing("refresh") && <ErrorTimer />}
        </button>
      </div>
      <ul className="space-y-0.5">
        {schemas.map((s) => {
          const items = rels[s.name] ?? [];
          const tables = items.filter((r) => TABLE_KINDS.includes(kindChar(r.kind)));
          const views = items.filter((r) => VIEW_KINDS.includes(kindChar(r.kind)));
          return (
            <li key={s.name}>
              <button
                onClick={() => toggle(s.name)}
                aria-disabled={isFlashing(s.name) || undefined}
                className={cn(
                  "relative flex w-full items-center gap-1.5 overflow-hidden px-1.5 py-1 text-sm transition-colors hover:bg-ink/[0.05]",
                  isFlashing(s.name) && "pointer-events-none",
                )}
              >
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted/70 transition-transform",
                    expanded[s.name] && "rotate-90 text-accent",
                  )}
                />
                <Boxes className="h-3.5 w-3.5 shrink-0 text-muted/70" />
                <span className="truncate">{s.name}</span>
                {isFlashing(s.name) && <ErrorTimer />}
              </button>
              {expanded[s.name] && (
                <ul className="ml-[14px] space-y-0.5 border-l border-ink/[0.08] pl-2.5">
                  <Group icon={<Table2 className="h-3.5 w-3.5" />} items={tables} onOpen={openRelation} empty="no tables" />
                  <Group icon={<Eye className="h-3.5 w-3.5" />} items={views} onOpen={openRelation} empty="no views" />
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Group({
  icon,
  items,
  onOpen,
  empty,
}: {
  icon: React.ReactNode;
  items: RelationInfo[];
  onOpen: (r: RelationInfo, run: boolean) => void;
  empty: string;
}) {
  if (items.length === 0) {
    return <li className="px-1.5 py-0.5 text-[11px] text-muted/60">{empty}</li>;
  }
  return (
    <>
      {items.map((r) => (
        <li key={`${r.schema}.${r.name}`}>
          <button
            onClick={() => onOpen(r, false)}
            onDoubleClick={() => onOpen(r, true)}
            title={r.comment ?? undefined}
            className="flex w-full items-center gap-1.5 px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-ink/[0.05]"
          >
            <span className="shrink-0 text-muted/70">{icon}</span>
            <span className="truncate">{r.name}</span>
          </button>
        </li>
      ))}
    </>
  );
}

/** Map the serialized RelationKind back to a relkind-ish char for grouping. */
function kindChar(kind: RelationInfo["kind"]): string {
  switch (kind) {
    case "table":
      return "r";
    case "partitioned_table":
      return "p";
    case "view":
      return "v";
    case "materialized_view":
      return "m";
    case "foreign_table":
      return "f";
    default:
      return "?";
  }
}
