import type { Actor } from '#app/features/auth/auth.types';
import type { EsignDocument } from '../entities/esign-document.entity';

export function actorAudit(actor: Actor) {
  return {
    createdByActorKind: actor.kind,
    createdByUserId: actor.kind === 'employee' ? actor.userId : null,
    updatedByActorKind: actor.kind,
    updatedByUserId: actor.kind === 'employee' ? actor.userId : null,
  };
}

/** 只更新最後操作者；原建立者與建立部門不變。 */
export function markDocumentUpdated(
  document: EsignDocument,
  actor: Actor,
): void {
  document.updatedByActorKind = actor.kind;
  document.updatedByUserId = actor.kind === 'employee' ? actor.userId : null;
}
