import type { DocType } from '../types';

/** 新增電子簽文件的流程步驟（上傳文件） */
export const CREATE_STEPS = ['上傳文件', '設定簽署', '發起簽署'];
/** 新增簽到表的流程步驟 */
export const SHEET_STEPS = ['簽到表資訊', '設定簽署', '發起簽署'];

export const stepsOf = (docType: DocType) => (docType === 'sheet' ? SHEET_STEPS : CREATE_STEPS);
