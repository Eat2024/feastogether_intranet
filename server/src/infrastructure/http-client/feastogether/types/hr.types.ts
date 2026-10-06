/**
 * 饗賓 hr/* 端點的請求 / 回應型別（固定格式內 `data` 形狀）。
 * ponytail: 欄位依 docs/feastogether-api-integration-plan.md §10.14–10.17 逆推，
 * 待 UAT 實測樣本校正（collection 無 saved response）。
 */

/** exam_ticket / shift / check_in_log 共用的日期區間查詢。
 *  用 type alias（非 interface）以相容 Record<string, string> 的 query 拼接。 */
export type DateRangeQuery = {
  start_date: string;
  end_date: string;
};

/** hr/exam_ticket 回傳：准考證。 */
export interface ExamTicketItem {
  workstation: string;
  subject: string;
  exam_date: string;
  exam_place: string;
}

/** hr/shift 回傳：班別（備註：start_date/end_date 實為時間）。 */
export interface ShiftItem {
  date: string;
  shift_code: string;
  start_date: string;
  end_date: string;
}

/** hr/check_in_log 回傳：打卡上下班。 */
export interface CheckInLogItem {
  date: string;
  check_in_time: string;
  check_out_time: string;
  duty_status: string;
}

/** hr/team_members 回傳：依權限代號查到的團隊成員。 */
export interface TeamMemberItem {
  person_empid: string;
  person_name: string;
  today_shift: string;
  sanke_case: string;
}
