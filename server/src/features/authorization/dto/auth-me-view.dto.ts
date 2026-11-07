import type { SessionView } from '#app/features/auth/dto/session-view.dto';
import type { AuthorizationViewDto } from './authorization-view.dto';

/** 目前 session 白名單資料與有效能力；不公開任何角色資訊。 */
export type AuthMeViewDto = SessionView & {
  modules: AuthorizationViewDto['modules'];
};
