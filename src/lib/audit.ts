import "server-only";

import { db } from "@/db";
import { auditLogs } from "@/db/schema";

export async function audit(input: {
  orgId: string;
  actorId?: string | null;
  entity: string;
  entityId?: string | null;
  action: string;
  diff?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLogs).values({
    orgId: input.orgId,
    actorId: input.actorId ?? null,
    entity: input.entity,
    entityId: input.entityId ?? null,
    action: input.action,
    diff: input.diff ?? null,
  });
}
