import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { PortalDirectoryService } from '#app/infrastructure/portal/portal-directory.service';
import {
  PORTAL_ACTIVE_STATUS_NAMES,
  blankToNull,
  type PortalStaffRow,
} from '#app/infrastructure/portal/portal.types';
import { StaffLookupDto } from '../dto/staff-lookup.dto';

/** 登入時向 Portal 即時查員工資料，只放行可登入的試用／正式員工。 */
@Injectable()
export class EligibleStaffService {
  constructor(private readonly portal: PortalDirectoryService) {}

  /** 只接受員編完全相同（Portal collation 不分大小寫、忽略尾端空白）、剛好一筆且欄位合法的試用／正式資料。 */
  async lookupEligibleStaff(empId: string): Promise<StaffLookupDto> {
    let rows: PortalStaffRow[];
    try {
      rows = await this.portal.findEmployeesByEmpid(empId);
    } catch {
      // 原始錯誤可能含 Portal 主機、帳號與員編，不記錄也不帶出。
      throw new AppException(...AppErrors.STAFF_LOOKUP_FAILED);
    }
    const eligible = rows.filter(
      (row) =>
        row.person_empid === empId &&
        row.person_status in PORTAL_ACTIVE_STATUS_NAMES,
    );
    if (eligible.length !== 1) throw rejected();
    const [row] = eligible;
    // Portal 字串欄位 NOT NULL DEFAULT ''；照原來源（饗賓人同步）trim 並把空白轉 null，沒有部門的員工才能通過驗證。
    const staff = plainToInstance(StaffLookupDto, {
      person_empid: row.person_empid,
      person_name: blankToNull(row.person_name),
      department_id: blankToNull(row.department_id),
      department_name: blankToNull(row.department_name),
      title: blankToNull(row.title),
      person_status: row.person_status,
      person_status_name: PORTAL_ACTIVE_STATUS_NAMES[row.person_status],
    });
    if ((await validate(staff)).length > 0) throw rejected();
    return staff;
  }
}

function rejected(): AppException {
  return new AppException(...AppErrors.AUTH_EXCHANGE_FAILED);
}
