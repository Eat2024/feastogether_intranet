import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Actor } from '#app/features/auth/auth.types';
import { CurrentActor } from '#app/framework/decorators/current-actor.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { SuperUserOnly } from '../decorators/require-permissions.decorator';
import { AuthorizationAssignmentService } from '../services/authorization-assignment.service';

/** 員編只由寫入 body 接收；讀取路徑使用本地 ID，輸出不含原始人事資料。 */
@Controller('authorization/modules/:moduleKey')
@SuperUserOnly()
export class AuthorizationAssignmentsController {
  constructor(private readonly assignments: AuthorizationAssignmentService) {}
  @Post('employee-role-assignments')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  assign(
    @CurrentActor() actor: Actor,
    @Param('moduleKey') moduleKey: string,
    @Body() body: unknown,
  ) {
    return this.assignments.assign({ source: 'http', actor }, moduleKey, body);
  }
  @Get('employees/:userId/roles')
  @Header('Cache-Control', 'no-store')
  employeeRoles(
    @CurrentActor() actor: Actor,
    @Param('moduleKey') moduleKey: string,
    @Param('userId') userId: string,
  ) {
    return this.assignments.employeeRoles(
      { source: 'http', actor },
      moduleKey,
      userId,
    );
  }
  @Get('roles/:roleId/employees')
  @Header('Cache-Control', 'no-store')
  roleEmployees(
    @CurrentActor() actor: Actor,
    @Param('moduleKey') moduleKey: string,
    @Param('roleId') roleId: string,
    @Query() query: unknown,
  ) {
    return this.assignments.roleEmployees(
      { source: 'http', actor },
      moduleKey,
      roleId,
      query,
    );
  }
}
