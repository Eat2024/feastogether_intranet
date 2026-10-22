import type { EFormDoc, StaffMember } from './types';

/** 員工名冊（選擇簽署人用） */
export const MOCK_EMPLOYEES: StaffMember[] = [
  { id: 'u1', name: '許婷惠', employeeNo: '10150032', dept: '專案管理部' },
  { id: 'u2', name: '徐瑩珊', employeeNo: '10160147', dept: '專案管理部' },
  { id: 'u3', name: '李秉彥', employeeNo: '10170289', dept: '系統維運部' },
  { id: 'u4', name: '陳韋齊', employeeNo: '10190315', dept: '系統維運部' },
  { id: 'u5', name: '陳柏丞', employeeNo: '10180423', dept: '系統維運部' },
  { id: 'u6', name: '林品妤', employeeNo: '10230156', dept: '人力資源部' },
  { id: 'u7', name: '黃啟軒', employeeNo: '10210788', dept: '財務部' },
];

/** 目前登入者（尚未串接登入，先固定為組織架構中的陳柏丞 11506071） */
export const CURRENT_USER_ID = '11506071';
/** 沒有組織架構檔時改用的目前登入者（假資料的李秉彥） */
export const FALLBACK_USER_ID = 'u3';

// 簽到表原型的暫存資料初始值：預設沒有文件（上傳文件已改由後端處理），簽到表於畫面上建立後才存在
export const MOCK_FORMS: EFormDoc[] = [];
