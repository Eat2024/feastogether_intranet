import { savePdf } from '@/features/forms/files';

/**
 * 上傳文件原始檔（新增／編輯電子簽文件時）。回傳檔案 id 與伺服器端讀出的頁數。
 * 不用 Server Action：檔案可能超過 Server Action 的 body 上限。
 * TODO: 串接登入與權限後，限制只有可建立文件的使用者能上傳
 */
export async function POST(request: Request) {
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    return Response.json({ error: '上傳內容不正確' }, { status: 400 });
  }
  if (!(file instanceof File)) return Response.json({ error: '請選擇檔案' }, { status: 400 });
  const result = await savePdf(file.name, new Uint8Array(await file.arrayBuffer()));
  return 'error' in result ? Response.json(result, { status: 400 }) : Response.json(result);
}
