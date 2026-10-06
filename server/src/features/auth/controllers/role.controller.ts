import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import configPath from '#app/config/config.path';
import { API_KEYS } from '#app/features/auth/api-keys';
import { ROLE_MANAGEMENT } from '#app/features/auth/seeds/permission-dictionary';
import { RegisterApi } from '#app/framework/decorators/register-api.decorator';
import { CreateRoleDto } from '#app/features/auth/dto/create-role.dto';
import { RenameRoleDto } from '#app/features/auth/dto/rename-role.dto';
import { ReorderRolesDto } from '#app/features/auth/dto/reorder-roles.dto';
import { SetRolePermissionsDto } from '#app/features/auth/dto/set-role-permissions.dto';
import { RoleService } from '#app/features/auth/services/role.service';

// 權限鍵引用 permission-dictionary enum（2026-07-25 全 repo 統一；drift 由字典 spec 防護）
const VIEW = [ROLE_MANAGEMENT.VIEW];
const CREATE_EDIT = [ROLE_MANAGEMENT.CREATE_EDIT];
const DELETE = [ROLE_MANAGEMENT.DELETE];

/** 角色與權限層級 API（Story 1）。授權由 @RegisterApi 宣告 + AuthGuard 強制。 */
@ApiTags('roles')
@Controller(configPath.ROLES)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @RegisterApi({
    key: API_KEYS.ROLES_LIST,
    name: '角色列表',
    permissions: VIEW,
  })
  @ApiOperation({ summary: '角色列表（含 userCount）' })
  list() {
    return this.roleService.list();
  }

  // 靜態路由須置於 :id/permissions 之前，否則 'permissions' 會落入 :id 觸發 ParseIntPipe 400。
  @Get('permissions')
  @RegisterApi({
    key: API_KEYS.ROLES_PERMISSIONS_CATALOG,
    name: '全權限目錄',
    permissions: VIEW,
  })
  @ApiOperation({ summary: '全權限目錄（分組→功能→權限，含 permissionId）' })
  getPermissionCatalog() {
    return this.roleService.getPermissionCatalog();
  }

  @Get(':id/permissions')
  @RegisterApi({
    key: API_KEYS.ROLES_PERMISSIONS_VIEW,
    name: '角色權限層級',
    permissions: VIEW,
  })
  @ApiOperation({ summary: '取得單一角色權限' })
  getPermissions(@Param('id', ParseIntPipe) id: number) {
    return this.roleService.getPermissionMatrix(id);
  }

  @Get(':id/users')
  @RegisterApi({
    key: API_KEYS.ROLES_USERS_LIST,
    name: '角色使用者清單',
    permissions: VIEW,
  })
  @ApiOperation({ summary: '綁定此角色的使用者清單' })
  getUsers(@Param('id', ParseIntPipe) id: number) {
    return this.roleService.getRoleUsers(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RegisterApi({
    key: API_KEYS.ROLES_CREATE,
    name: '新增角色',
    permissions: CREATE_EDIT,
  })
  @ApiOperation({ summary: '新增角色' })
  create(@Body() dto: CreateRoleDto) {
    return this.roleService.create(dto);
  }

  @Put(':id/permissions')
  @HttpCode(HttpStatus.OK)
  @RegisterApi({
    key: API_KEYS.ROLES_PERMISSIONS_SET,
    name: '設定角色權限',
    permissions: CREATE_EDIT,
  })
  @ApiOperation({ summary: '設定角色權限（整組覆蓋）' })
  setPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.roleService.setPermissions(id, dto);
  }

  // 靜態路由 reorder 須置於 :id 之前，否則 'reorder' 會落入 :id 觸發 ParseIntPipe 400。
  @Put('reorder')
  @HttpCode(HttpStatus.OK)
  @RegisterApi({
    key: API_KEYS.ROLES_REORDER,
    name: '角色排序',
    permissions: CREATE_EDIT,
  })
  @ApiOperation({
    summary: '角色排序與批次改名（依傳入順序重排，可一併更新名稱）',
  })
  reorder(@Body() dto: ReorderRolesDto) {
    return this.roleService.reorder(dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RegisterApi({
    key: API_KEYS.ROLES_DELETE,
    name: '刪除角色',
    permissions: DELETE,
  })
  @ApiOperation({ summary: '軟刪除角色' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.roleService.softDelete(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RegisterApi({
    key: API_KEYS.ROLES_RENAME,
    name: '角色改名',
    permissions: CREATE_EDIT,
  })
  @ApiOperation({ summary: '角色改名（部分更新）' })
  rename(@Param('id', ParseIntPipe) id: number, @Body() dto: RenameRoleDto) {
    return this.roleService.rename(id, dto);
  }
}
