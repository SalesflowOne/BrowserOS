import type { ReactNode } from 'react'
import { StepDots } from './StepDots'
import { VisualRail } from './VisualRail'

interface OnboardingShellProps {
  step: number
  totalSteps: number
  children: ReactNode
}

/** Provides the shared window frame, visual rail, and step progress chrome. */
export function OnboardingShell({
  step,
  totalSteps,
  children,
}: OnboardingShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-canvas p-6">
      <div
        className="flex h-[720px] w-full max-w-[1040px] flex-col overflow-hidden rounded-2xl border border-border-2 bg-bg-canvas shadow-2xl"
        role="dialog"
        aria-label="BrowserOS onboarding"
      >
        <div className="flex h-11 items-center border-border border-b bg-bg-canvas px-4">
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-full bg-[#FF5F57]" />
            <span aria-hidden className="size-3 rounded-full bg-[#FEBC2E]" />
            <span aria-hidden className="size-3 rounded-full bg-[#28C840]" />
          </div>
          <div className="flex-1 text-center font-semibold text-[12.5px] text-ink-3">
            Welcome to BrowserOS
          </div>
          <div className="w-[52px]" />
        </div>
        <div className="flex min-h-0 flex-1">
          <VisualRail />
          <div className="scroll flex flex-1 flex-col overflow-y-auto px-12 pt-11 pb-10">
            <div className="mb-[30px]">
              <StepDots step={step} total={totalSteps} />
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
