/**
 * 饗賓 brand/brand_info 的回應型別（固定格式內 `data` 形狀）。
 * ponytail: 欄位依 docs/feastogether-api-integration-plan.md §10.10 逆推，
 * 待 UAT 實測樣本校正（collection 無 saved response）。
 */

/** brand/brand_info 回傳：品牌及其下屬門市。 */
export interface BrandInfoItem {
  div_code: string;
  short_code: string;
  brand_name: string;
  abbr: string;
  description: string;
  logo_url: string;
  booking_url: string;
  department_list: string[];
}
