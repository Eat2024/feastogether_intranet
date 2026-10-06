/**
 * 饗賓 staff/all_department + staff/all_search_department 的回應型別。
 * ponytail: 欄位依 docs/feastogether-api-integration-plan.md §10.11–10.12 逆推，
 * 待 UAT 實測樣本校正（collection 無 saved response）。
 */

/** staff/all_department 回傳：部門列表（公告選擇用）。 */
export interface DepartmentItem {
  dep_code: string;
  dep_name: string;
}

/** staff/all_search_department 回傳：搜尋部門下拉（含總部與各營業點）。 */
export interface SearchDepartmentGroup {
  category_id: string;
  category_name: string;
  department_list: SearchDepartmentOption[];
}

export interface SearchDepartmentOption {
  department_id: string;
  department_name: string;
}
