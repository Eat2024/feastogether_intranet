import { Controller, Get, SetMetadata } from '@nestjs/common';
import { Public } from '#app/framework/decorators/public.decorator';
import {
  AuthenticatedOnly,
  RequirePermissions,
} from '../decorators/require-permissions.decorator';
import { validateAuthorizationRoutes } from './authorization-readiness.service';

@Controller('classified')
class Classified {
  @Public() @Get('public') publicRoute() {}
  @AuthenticatedOnly() @Get('session') session() {}
  @RequirePermissions('esign.document.read') @Get('document') document() {}
}
@Controller('unclassified')
class Unclassified {
  @Get() read() {}
}
@Controller('empty')
class Empty {
  @RequirePermissions() @Get() read() {}
}

@Controller('malformed')
class Malformed {
  @SetMetadata('authorizationRequirement', { mode: 'typo' }) @Get() read() {}
}

describe('授權啟用前的路由分類', () => {
  it('公開、僅登入與明確能力均可啟用，未分類或空能力拒絕啟用', () => {
    expect(() => validateAuthorizationRoutes([Classified])).not.toThrow();
    expect(() => validateAuthorizationRoutes([Unclassified])).toThrow('授權');
    expect(() => validateAuthorizationRoutes([Empty])).toThrow('授權');
    expect(() => validateAuthorizationRoutes([Malformed])).toThrow('授權');
  });
});
