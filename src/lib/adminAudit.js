import { base44 } from "@/api/base44Client";
import { maskEmail } from "@/lib/privacy";

export async function logAdminAction({ actor, action, targetType, targetId, details, severity = "info" }) {
  try {
    await base44.entities.AdminAuditLog.create({
      actor_id: actor?.id,
      actor_email: maskEmail(actor?.email),
      action,
      target_type: targetType,
      target_id: targetId,
      details,
      severity,
    });
  } catch {
    /* registro de auditoria é auxiliar */
  }
}