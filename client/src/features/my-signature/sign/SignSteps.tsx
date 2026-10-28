'use client';

import StepFlow from '@/components/StepFlow';
import { SIGN_STEPS } from '@/features/my-signature/sign/steps';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

/** 簽署步驟（與內部簽署相同）；手機寬度把步驟名稱放在圖示下方，四個步驟才放得下 */
export default function SignSteps({ activeIndex }: { activeIndex: number }) {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  return <StepFlow steps={SIGN_STEPS} activeIndex={activeIndex} alternativeLabel={narrow} />;
}
