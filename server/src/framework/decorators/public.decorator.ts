import { SetMetadata } from '@nestjs/common';

/** @Public() metadata key（AuthGuard / api-registry 共用）。 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
