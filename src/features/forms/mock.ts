import type { EFormDoc, Employee, StaffMember } from './types';

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

const CREATORS = {
  pinyu: { name: '林品妤', employeeNo: '10230156' },
  boyd: { name: '陳柏丞', employeeNo: '10180423' },
  chris: { name: '黃啟軒', employeeNo: '10210788' },
} satisfies Record<string, Employee>;

/** 目前登入者（尚未串接登入，先固定為李秉彥） */
export const CURRENT_USER_ID = 'u3';

// 假資料，串接 API 前供畫面呈現用
export const MOCK_FORMS: EFormDoc[] = [
  {
    id: 'f1',
    name: '2026 年度員工誠信聲明書',
    docNumber: 'ES-2026-0012',
    docType: 'online',
    status: 'active',
    startAt: '2026/08/20',
    endAt: '2026/10/31',
    signers: [
      { id: 'u1', name: '許婷惠', employeeNo: '10150032', status: 'signed', signedAt: '2026/08/21' },
      { id: 'u2', name: '徐瑩珊', employeeNo: '10160147', status: 'signed', signedAt: '2026/08/22' },
      { id: 'u3', name: '李秉彥', employeeNo: '10170289', status: 'pending' },
      { id: 'u4', name: '陳韋齊', employeeNo: '10190315', status: 'pending' },
    ],
    createdBy: CREATORS.pinyu,
  },
  {
    id: 'f2',
    name: '職場不法侵害防治教育訓練簽到',
    docNumber: null,
    docType: 'online',
    status: 'draft',
    startAt: null,
    endAt: null,
    signers: [],
    createdBy: CREATORS.pinyu,
  },
  {
    id: 'f3',
    name: '2025 年度資訊安全承諾書',
    docNumber: 'ES-2025-0087',
    docType: 'upload',
    status: 'active',
    startAt: '2025/11/01',
    endAt: '2025/12/31',
    signers: [
      { id: 'u3', name: '李秉彥', employeeNo: '10170289', status: 'signed', signedAt: '2025/11/03' },
      { id: 'u4', name: '陳韋齊', employeeNo: '10190315', status: 'signed', signedAt: '2025/11/04' },
      { id: 'u5', name: '陳柏丞', employeeNo: '10180423', status: 'signed', signedAt: '2025/11/05' },
    ],
    createdBy: CREATORS.boyd,
  },
  {
    id: 'f4',
    name: '供應商保密協議（NDA）',
    docNumber: 'ES-2026-0005',
    docType: 'upload',
    status: 'stopped',
    startAt: '2026/03/01',
    endAt: '2026/04/15',
    signers: [
      { id: 'u7', name: '黃啟軒', employeeNo: '10210788', status: 'signed', signedAt: '2026/03/02' },
      { id: 'u1', name: '許婷惠', employeeNo: '10150032', status: 'pending' },
    ],
    createdBy: CREATORS.chris,
  },
  {
    id: 'f5',
    name: '2026 年度個人資料保護同意書',
    docNumber: 'ES-2026-0031',
    docType: 'online',
    status: 'active',
    startAt: '2026/09/01',
    endAt: '2026/10/01',
    signers: [
      { id: 'u1', name: '許婷惠', employeeNo: '10150032', status: 'signed', signedAt: '2026/09/02' },
      { id: 'u3', name: '李秉彥', employeeNo: '10170289', status: 'pending' },
      { id: 'u5', name: '陳柏丞', employeeNo: '10180423', status: 'pending' },
    ],
    createdBy: CREATORS.pinyu,
  },
  {
    id: 'f6',
    name: '加班制度調整公告簽收',
    docNumber: 'ES-2026-0027',
    docType: 'upload',
    status: 'active',
    startAt: '2026/09/10',
    endAt: '2026/10/20',
    signers: [
      { id: 'u2', name: '徐瑩珊', employeeNo: '10160147', status: 'signed', signedAt: '2026/09/11' },
      {
        id: 'u3',
        name: '李秉彥',
        employeeNo: '10170289',
        status: 'rejected',
        rejectedAt: '2026/09/15',
        rejectReason: '公告內容與部門實際排班方式不符，請人資部再確認後重新發起。',
      },
      { id: 'u4', name: '陳韋齊', employeeNo: '10190315', status: 'pending' },
    ],
    createdBy: CREATORS.chris,
  },
];
