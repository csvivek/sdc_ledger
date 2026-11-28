// Called by server actions after a change succeeds. On Supabase this does
// nothing (database triggers write the log); in fake-data mode it writes the
// log line. A failure to log never undoes or fails the change itself.

import { getExtras } from "./data/extras";
import { isSupabaseConfigured } from "./supabase/config";
import type { ActivityAction } from "./activity";
import type { User } from "./types";

export async function noteActivity(
  user: Pick<User, "id">,
  action: ActivityAction,
  entity: string,
  entityId: string | undefined,
  data: { before?: object; after?: object } = {},
) {
  if (isSupabaseConfigured) return;
  try {
    await getExtras().noteActivity({
      actorId: user.id,
      action,
      entity,
      entityId,
      before: data.before as Record<string, unknown> | undefined,
      after: data.after as Record<string, unknown> | undefined,
    });
  } catch (err) {
    console.error("noteActivity failed", err);
  }
}
