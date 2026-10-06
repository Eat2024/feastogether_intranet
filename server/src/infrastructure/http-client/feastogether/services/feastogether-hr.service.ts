import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { StaffLookupDto } from '../types/staff-lookup.dto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { FeastogetherClient } from '../feastogether.client';
import { mapFeastogetherUpstreamError } from '../feastogether-error.util';
import {
  CheckInLogItem,
  DateRangeQuery,
  ExamTicketItem,
  ShiftItem,
  TeamMemberItem,
} from '../types/hr.types';

const PATHS = {
  examTicket: '/api/v1/hr/exam_ticket',
  shift: '/api/v1/hr/shift',
  checkInLog: '/api/v1/hr/check_in_log',
  teamMembers: '/api/v1/hr/team_members',
} as const;

/**
 * 饗賓 hr/* 端點，員編查詢僅用 API Key，其餘需 Bearer。token 由呼叫端顯式帶入
 * （CLS 自動注入待有 controller 消費再接）。
 */
@Injectable()
export class FeastogetherHrService {
  constructor(private readonly client: FeastogetherClient) {}

  /** 依員編片段查詢員工。 */
  async lookupStaff(empId: string): Promise<StaffLookupDto[]> {
    try {
      return await this.client.get<StaffLookupDto[]>(
        withQuery('/api/v1/hr/staff_lookup', { person_empid: empId }),
      );
    } catch {
      throw staffLookupError();
    }
  }

  /** 准考證（依日期區間）。 */
  getExamTicket(
    token: string,
    range: DateRangeQuery,
  ): Promise<ExamTicketItem[]> {
    return this.get<ExamTicketItem[]>(PATHS.examTicket, token, range);
  }

  /** 我的班別（依日期區間；start_date/end_date 實為時間）。 */
  getShift(token: string, range: DateRangeQuery): Promise<ShiftItem[]> {
    return this.get<ShiftItem[]>(PATHS.shift, token, range);
  }

  /** 我的打卡（依日期區間）。 */
  getCheckInLog(
    token: string,
    range: DateRangeQuery,
  ): Promise<CheckInLogItem[]> {
    return this.get<CheckInLogItem[]>(PATHS.checkInLog, token, range);
  }

  /** 團隊成員（依權限代號）。 */
  getTeamMembers(token: string, authCode: string): Promise<TeamMemberItem[]> {
    return this.get<TeamMemberItem[]>(PATHS.teamMembers, token, {
      auth_code: authCode,
    });
  }

  private async get<T>(
    path: string,
    token: string,
    query: Record<string, string>,
  ): Promise<T> {
    try {
      return await this.client.get<T>(withQuery(path, query), { token });
    } catch (error) {
      throw mapFeastogetherUpstreamError(error);
    }
  }
}

/** 把 query 物件接到相對 path 後（值經 URL 編碼）。 */
function withQuery(path: string, query: Record<string, string>): string {
  const qs = new URLSearchParams(query).toString();
  return qs ? `${path}?${qs}` : path;
}

/** 員工查詢／匯入失敗的固定對外訊息。 */
export function staffLookupError(): AppException {
  return new AppException(
    AppErrorCode.STAFF_LOOKUP_FAILED,
    '系統有錯，請詢問IT部門',
    HttpStatus.BAD_GATEWAY,
  );
}
