// A tiny stand-in for the Supabase client, enough to test how the stores
// behave when a table from an unrun migration is missing. Not a database:
// filters are recorded, not applied, except eq on simple equality.

type Row = Record<string, unknown>;

export interface FakeDb {
  tables: Record<string, Row[]>;
  /** Tables that do not exist (as if their SQL was not run). */
  missing: Set<string>;
  inserted: Record<string, Row[]>;
  rpcs: { name: string; args: unknown }[];
  rpcResult?: (name: string, args: unknown) => { data: unknown; error: { code?: string; message: string } | null };
}

export function fakeDb(tables: Record<string, Row[]> = {}, missing: string[] = []): FakeDb {
  return { tables, missing: new Set(missing), inserted: {}, rpcs: [] };
}

const notFound = (t: string) => ({ code: "PGRST205", message: `Could not find the table 'public.${t}' in the schema cache` });

export function fakeClient(db: FakeDb) {
  const builder = (table: string) => {
    const rows = () => db.tables[table] ?? [];
    let insertRows: Row[] | null = null;
    let head = false;
    const filters: ((r: Row) => boolean)[] = [];
    const q = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        head = Boolean(opts?.head);
        return q;
      },
      order() { return q; },
      limit() { return q; },
      range() { return q; },
      eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return q; },
      gte(col: string, v: string) { filters.push((r) => String(r[col]) >= v); return q; },
      lt(col: string, v: string) { filters.push((r) => String(r[col]) < v); return q; },
      in(col: string, vs: unknown[]) { filters.push((r) => vs.includes(r[col])); return q; },
      insert(r: Row | Row[]) { insertRows = Array.isArray(r) ? r : [r]; return q; },
      upsert(r: Row | Row[]) { insertRows = Array.isArray(r) ? r : [r]; return q; },
      update() { return q; },
      delete() { return q; },
      single() { return q; },
      maybeSingle() { return q; },
      then(resolve: (v: unknown) => void) {
        if (db.missing.has(table)) return resolve({ data: null, error: notFound(table), count: null });
        if (insertRows) {
          (db.inserted[table] ??= []).push(...insertRows);
          return resolve({ data: insertRows, error: null });
        }
        const out = rows().filter((r) => filters.every((f) => f(r)));
        return resolve(head ? { data: null, error: null, count: out.length } : { data: out, error: null, count: out.length });
      },
    };
    return q;
  };
  return {
    from: builder,
    rpc(name: string, args: unknown) {
      db.rpcs.push({ name, args });
      const res = db.rpcResult?.(name, args) ?? { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } };
      return Promise.resolve(res);
    },
  };
}
