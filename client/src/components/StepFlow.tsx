import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";

/** 多步驟流程的進度條；activeIndex 之前的步驟顯示為已完成 */
export default function StepFlow({ steps, activeIndex }: { steps: string[]; activeIndex: number }) {
  return (
    <Stepper activeStep={activeIndex}>
      {steps.map((label, i) => (
        <Step key={label} completed={i < activeIndex}>
          <StepLabel>{label}</StepLabel>
        </Step>
      ))}
    </Stepper>
  );
}
