import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getExtras } from "@/lib/data/extras";
import { ACTION_LABEL, actorLabel, describeActivity, ENTITY_LABEL } from "@/lib/activity";

export const dynamic = "force-dynamic";

const PAGE = 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ who?: string; what?: string; from?: string; to?: string; before?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const x = getExtras();
  const { people } = await x.listPeople();
  const filter = {
    actorId: people.some((p) => p.id === sp.who) ? sp.who : undefined,
    entity: sp.what && sp.what in ENTITY_LABEL ? sp.what : undefined,
    from: sp.from && DAY.test(sp.from) ? sp.from : undefined,
    to: sp.to && DAY.test(sp.to) ? sp.to : undefined,
    before: sp.before,
    limit: PAGE,
  };
  const log = await x.listActivity(filter);
  const rows = log.ready ? log.value : [];
  const qs = (extra: Record<string, string | undefined>) =>
    new URLSearchParams(Object.entries({ who: filter.actorId, what: filter.entity, from: filter.from, to: filter.to, ...extra }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <h1>Activity</h1>
      <p className="muted">Who added, changed or deleted what, newest first. Times are India time. Nobody can edit or remove these lines.</p>

      <form method="get" action="/activity" className="card form-card">
        <label htmlFor="act-who">Person</label>
        <select id="act-who" name="who" defaultValue={filter.actorId ?? ""}>
          <option value="">Everyone</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <label htmlFor="act-what">What</label>
        <select id="act-what" name="what" defaultValue={filter.entity ?? ""}>
          <option value="">Everything</option>
          {Object.entries(ENTITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <label htmlFor="act-from">From day</label>
        <input id="act-from" name="from" type="date" defaultValue={filter.from} />
        <label htmlFor="act-to">To day</label>
        <input id="act-to" name="to" type="date" defaultValue={filter.to} />
        <button type="submit" className="secondary full">Show</button>
      </form>

      {!log.ready ? (
        <p className="notice">The activity log is not switched on yet. It starts recording once the staff and activity SQL is run.</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nothing recorded{filter.actorId || filter.entity || filter.from || filter.to ? " for this choice" : " yet"}.</p>
      ) : (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Did</th>
                <th>What</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="row-title">{when(e.at)}</td>
                  <td data-label="Who">{actorLabel(e)}</td>
                  <td data-label="Did">
                    <span className={`badge act-${e.action}`}>{ACTION_LABEL[e.action]}</span> {ENTITY_LABEL[e.entity] ?? e.entity}
                  </td>
                  <td data-label="What" className="wrap">{describeActivity(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === PAGE && (
        <p>
          <Link href={`/activity?${qs({ before: rows[rows.length - 1].id })}`}>Older entries →</Link>
        </p>
      )}
      {filter.before && (
        <p>
          <Link href={`/activity?${qs({})}`}>← Back to newest</Link>
        </p>
      )}
    </>
  );
}
