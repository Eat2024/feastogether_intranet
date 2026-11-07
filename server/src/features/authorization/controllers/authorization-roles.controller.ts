import {
  Body,
  Patch,
  Put,
  Delete,
  HttpCode,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Actor } from '#app/features/auth/auth.types';
import { CurrentActor } from '#app/framework/decorators/current-actor.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { SuperUserOnly } from '../decorators/require-permissions.decorator';
import { AuthorizationRoleService } from '../services/authorization-role.service';

/** 輸入由共用管理服務的 DTO 驗證，HTTP 與 REPL 使用相同錯誤契約。 */
@Controller('authorization/modules')
@SuperUserOnly()
export class AuthorizationRolesController {
  constructor(private readonly roles: AuthorizationRoleService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  modules(@CurrentActor() actor: Actor) {
    return this.roles.modules({ source: 'http', actor });
  }
  @Get(':moduleKey/permissions')
  @Header('Cache-Control', 'no-store')
  permissions(
    @CurrentActor() actor: Actor,
    @Param('moduleKey') moduleKey: string,
  ) {
    return this.roles.permissions({ source: 'http', actor }, moduleKey);
  }
  @Get(':moduleKey/roles')
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentActor() actor: Actor,
    @Param('moduleKey') moduleKey: string,
    @Query() query: unknown,
  ) {
    return this.roles.list({ source: 'http', actor }, moduleKey, query);
  }
  @Get(':moduleKey/roles/:roleId')
  @Header('Cache-Control', 'no-store')
  detail(
    @CurrentActor() actor: Actor,
    @Param('moduleKey') moduleKey: string,
    @Param('roleId') roleId: string,
  ) {
    return this.roles.detail({ source: 'http', actor }, moduleKey, roleId);
  }
  @Post(':moduleKey/roles')
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  create(
    @CurrentActor() actor: Actor,
    @Param('moduleKey') moduleKey: string,
    @Body() body: unknown,
  ) {
    return this.roles.create({ source: 'http', actor }, moduleKey, body);
  }
  @Patch(':moduleKey/roles/:roleId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  update(
    @CurrentActor() actor: Actor,
    @Param('moduleKey') moduleKey: string,
    @Param('roleId') roleId: string,
    @Body() body: unknown,
  ) {
    return this.roles.update(
      { source: 'http', actor },
      moduleKey,
      roleId,
      body,
    );
  }
  @Put(':moduleKey/roles/:roleId/permissions')
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  setPermissions(
    @CurrentActor() actor: Actor,
    @Param('moduleKey') moduleKey: string,
    @Param('roleId') roleId: string,
    @Body() body: unknown,
  ) {
    return this.roles.setPermissions(
      { source: 'http', actor },
      moduleKey,
      roleId,
      body,
    );
  }
  @Delete(':moduleKey/roles/:roleId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  delete(
    @CurrentActor() actor: Actor,
    @Param('moduleKey') moduleKey: string,
    @Param('roleId') roleId: string,
    @Query() query: unknown,
  ) {
    return this.roles.delete(
      { source: 'http', actor },
      moduleKey,
      roleId,
      query,
    );
  }
}
