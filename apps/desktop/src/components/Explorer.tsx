import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Table2, Eye, Boxes } from "lucide-react";
import { api, errMessage, type RelationInfo, type SchemaInfo } from "@/lib/api";
import { useStore } from "@/store";
import { cn } from "@/lib/utils";

const TABLE_KINDS = ["r", "p"];
const VIEW_KINDS = ["v", "m"];

export function Explorer() {
  const session = useStore((s) => s.session);
  const setQuery = useStore((s) => s.setQuery);
  const requestRun = useStore((s) => s.requestRun);
  const openTable = useStore((s) => s.openTable);
  const showQuery = useStore((s) => s.showQuery);

  const [schemas, setSchemas] = useState<SchemaInfo[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [rels, setRels] = useState<Record<string, RelationInfo[]>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setSchemas([]);
      setRels({});
      setExpanded({});
      return;
    }
    (async () => {
      try {
        setSchemas(await api.schemaList(session.sessionId));
      } catch (e) {
        setErr(errMessage(e));
      }
    })();
  }, [session]);

  const toggle = useCallback(
    async (schema: string) => {
      setExpanded((e) => ({ ...e, [schema]: !e[schema] }));
      if (!rels[schema] && session) {
        try {
          const all = await api.relationList(session.sessionId, schema, [
            ...TABLE_KINDS,
            ...VIEW_KINDS,
          ]);
          setRels((r) => ({ ...r, [schema]: all }));
        } catch (e) {
          setErr(errMessage(e));
        }
      }
    },
    [rels, session],
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
    return (
      <p className="px-1 text-xs text-muted-foreground">
        Connect to a server to browse its objects.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {session.name}
      </p>
      {err && <p className="px-1 text-xs text-red-400">{err}</p>}
      <ul className="space-y-0.5">
        {schemas.map((s) => {
          const items = rels[s.name] ?? [];
          const tables = items.filter((r) => TABLE_KINDS.includes(kindChar(r.kind)));
          const views = items.filter((r) => VIEW_KINDS.includes(kindChar(r.kind)));
          return (
            <li key={s.name}>
              <button
                onClick={() => toggle(s.name)}
                className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-sm hover:bg-muted"
              >
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 transition-transform",
                    expanded[s.name] && "rotate-90",
                  )}
                />
                <Boxes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{s.name}</span>
              </button>
              {expanded[s.name] && (
                <ul className="ml-4 space-y-0.5 border-l pl-2">
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
    return <li className="px-1 py-0.5 text-[11px] text-muted-foreground">{empty}</li>;
  }
  return (
    <>
      {items.map((r) => (
        <li key={`${r.schema}.${r.name}`}>
          <button
            onClick={() => onOpen(r, false)}
            onDoubleClick={() => onOpen(r, true)}
            title={r.comment ?? undefined}
            className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13px] hover:bg-muted"
          >
            <span className="shrink-0 text-muted-foreground">{icon}</span>
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
