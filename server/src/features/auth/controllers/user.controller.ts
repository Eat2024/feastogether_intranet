import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import configPath from '#app/config/config.path';
import { API_KEYS } from '#app/features/auth/api-keys';
import { ACCOUNT_MANAGEMENT } from '#app/features/auth/seeds/permission-dictionary';
import { RegisterApi } from '#app/framework/decorators/register-api.decorator';
import { BatchUpdateStatusDto } from '#app/features/auth/dto/batch-update-status.dto';
import { ListUsersDto } from '#app/features/auth/dto/list-users.dto';
import { SearchEmployeeOptionsDto } from '#app/features/auth/dto/search-employee-options.dto';
import { UpdateUserDto } from '#app/features/auth/dto/update-user.dto';
import { UserAccountService } from '#app/features/auth/services/user-account.service';

// 權限鍵引用 permission-dictionary enum（2026-07-25 全 repo 統一；drift 由字典 spec 防護）
const VIEW = [ACCOUNT_MANAGEMENT.VIEW];
const CREATE_EDIT = [ACCOUNT_MANAGEMENT.CREATE_EDIT];

/** 使用者帳號與角色指派 API（Story 2）。未建檔者僅能由 fgapi 查詢後於角色儲存時匯入。 */
@ApiTags('users')
@Controller(configPath.USERS)
export class UserController {
  constructor(private readonly userAccount: UserAccountService) {}

  @Get()
  @RegisterApi({
    key: API_KEYS.USERS_LIST,
    name: '使用者列表',
    permissions: VIEW,
  })
  @ApiOperation({ summary: '使用者列表（分頁 + 關鍵字模糊搜尋）' })
  list(@Query() dto: ListUsersDto) {
    return this.userAccount.list(dto);
  }

  // 靜態路由須宣告於 @Get(':id') 之前，否則 'employees' 會被 :id 攔截。
  @Get('employees')
  @RegisterApi({
    key: API_KEYS.USERS_EMPLOYEE_OPTIONS,
    name: '員工選項（員編模糊搜尋）',
    permissions: CREATE_EDIT,
  })
  @ApiOperation({
    summary: '以 5～8 碼員編片段查 fgapi，最多回傳 50 筆 options（不建檔）',
  })
  employeeOptions(@Query() dto: SearchEmployeeOptionsDto) {
    return this.userAccount.searchEmployeeOptions(dto);
  }

  @Get(':id')
  @RegisterApi({
    key: API_KEYS.USERS_DETAIL,
    name: '使用者詳情',
    permissions: VIEW,
  })
  @ApiOperation({ summary: '使用者詳情' })
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.userAccount.getDetail(id);
  }

  // 靜態路由須宣告於 @Patch(':empId') 之前，否則 'status' 會被 :empId 當成員編攔截。
  @Patch('status')
  @HttpCode(HttpStatus.OK)
  @RegisterApi({
    key: API_KEYS.USERS_BATCH_STATUS,
    name: '批次啟用/停用使用者',
    permissions: CREATE_EDIT,
  })
  @ApiOperation({
    summary: '依 empId 批次更新啟用狀態（無法對超級管理員進行停權）',
  })
  batchStatus(@Body() dto: BatchUpdateStatusDto) {
    return this.userAccount.batchUpdateStatus(dto);
  }

  // 帳號管理流程只握有員編（員編搜尋 → 部門狀態 → 指派角色），拿不到內部 id，
  // 故以 person_empid（unique index）為資源識別子。詳情端點的 :id 沿用不受影響。
  @Patch(':empId')
  @HttpCode(HttpStatus.OK)
  @RegisterApi({
    key: API_KEYS.USERS_UPDATE,
    name: '更新使用者角色/狀態',
    permissions: CREATE_EDIT,
  })
  @ApiOperation({ summary: '更新使用者角色 / 啟用狀態 / 備註（部分更新）' })
  update(@Param('empId') empId: string, @Body() dto: UpdateUserDto) {
    return this.userAccount.updateRoleAndStatus(empId, dto);
  }
}
