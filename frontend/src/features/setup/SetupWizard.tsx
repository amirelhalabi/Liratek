import { SetupProvider, useSetup } from "./context/SetupContext";
import Step1Account from "./steps/Step1Account";
import Step2Modules from "./steps/Step2Modules";
import Step3Currencies from "./steps/Step3Currencies";
import Step4Users from "./steps/Step4Users";
import StepComplete from "./steps/StepComplete";

const STEPS = [
  { label: "Account" },
  { label: "Modules" },
  { label: "Currencies" },
  { label: "Users" },
  { label: "Done" },
];

function WizardContent() {
  const { step } = useSetup();

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
            LiraTek Setup
          </h1>
        </div>

        {/* Progress indicator */}
        {step < 5 && (
          <div className="flex items-center justify-center gap-2 mb-8">
            {STEPS.slice(0, 4).map((s, i) => {
              const stepNum = i + 1;
              const isDone = step > stepNum;
              const isCurrent = step === stepNum;
              return (
                <div key={i} className="flex items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      isDone
                        ? "bg-emerald-600 text-white"
                        : isCurrent
                          ? "bg-violet-600 text-white ring-2 ring-violet-400/30"
                          : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {isDone ? "✓" : stepNum}
                  </div>
                  <span
                    className={`ml-1.5 text-xs hidden sm:block ${
                      isCurrent ? "text-white" : "text-slate-500"
                    }`}
                  >
                    {s.label}
                  </span>
                  {i < 3 && (
                    <div
                      className={`mx-3 h-px w-8 ${
                        step > stepNum ? "bg-emerald-600" : "bg-slate-700"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl">
          {step === 1 && <Step1Account />}
          {step === 2 && <Step2Modules />}
          {step === 3 && <Step3Currencies />}
          {step === 4 && <Step4Users />}
          {step === 5 && <StepComplete />}
        </div>

        <p className="text-center text-xs text-slate-600 mt-4">
          Step {Math.min(step, 4)} of 4
        </p>
      </div>
    </div>
  );
}

export default function SetupWizard() {
  return (
    <SetupProvider>
      <WizardContent />
    </SetupProvider>
  );
}
