'use client';

// 須為 client 元件：圖示元素若在伺服器元件建立再傳給 IconButton，dev 模式會觸發 React 的 key 警告
import TooltipIconButton from '@/components/TooltipIconButton';
import DrawRoundedIcon from '@mui/icons-material/DrawRounded';

/** 「我的電子簽」待簽署分頁的「簽署」按鈕；不能簽署（已逾期、尚未開始）時停用 */
export default function SignActionButton({ formId, disabled }: { formId: string; disabled: boolean }) {
  return (
    <TooltipIconButton
      label="簽署"
      icon={<DrawRoundedIcon />}
      color="info"
      href={`/my-signature/${formId}`}
      disabled={disabled}
    />
  );
}
