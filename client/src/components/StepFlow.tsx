import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";

/**
 * 多步驟流程的進度條；activeIndex 之前的步驟顯示為已完成。
 * alternativeLabel：步驟名稱放在圖示下方（窄螢幕用）
 */
export default function StepFlow({
  steps,
  activeIndex,
  alternativeLabel = false,
}: {
  steps: string[];
  activeIndex: number;
  alternativeLabel?: boolean;
}) {
  return (
    <Stepper activeStep={activeIndex} alternativeLabel={alternativeLabel}>
      {steps.map((label, i) => (
        <Step key={label} completed={i < activeIndex}>
          <StepLabel>{label}</StepLabel>
        </Step>
      ))}
    </Stepper>
  );
}
