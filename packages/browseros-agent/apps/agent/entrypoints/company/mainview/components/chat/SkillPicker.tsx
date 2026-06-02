import { cn } from '@company/lib/utils'
import type {
  ExternalSkillRow,
  SkillRow,
} from '@company/modules/api/skills.hooks'
import { type ReactNode, useEffect, useRef } from 'react'

interface PickerSkill {
  name: string
  description: string
}

interface Props {
  builtInSkills: SkillRow[]
  userSkills: SkillRow[]
  externalSkills: ExternalSkillRow[]
  employeeSkillNames: string[]
  filter: string
  selectedIndex: number
  loading: boolean
  onSelect: (name: string) => void
  onHover: (index: number) => void
}

export function SkillPicker({
  builtInSkills,
  userSkills,
  externalSkills,
  employeeSkillNames,
  filter,
  selectedIndex,
  loading,
  onSelect,
  onHover,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex drives the scroll via DOM query, not a direct reference
  useEffect(() => {
    const selected = scrollRef.current?.querySelector<HTMLElement>(
      '[data-selected="true"]',
    )
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (loading) {
    return (
      <PickerFrame>
        <div className="px-4 py-5 text-center text-muted-foreground text-xs">
          Loading skills…
        </div>
      </PickerFrame>
    )
  }

  const lc = filter.toLowerCase()
  const matches = (s: PickerSkill) =>
    !lc ||
    s.name.toLowerCase().includes(lc) ||
    s.description.toLowerCase().includes(lc)

  const employeeSet = new Set(employeeSkillNames)
  const visibleEmployeeSkills = builtInSkills
    .filter((s) => employeeSet.has(s.name))
    .filter(matches)
  const visibleOtherBuiltIns = builtInSkills
    .filter((s) => !employeeSet.has(s.name))
    .filter(matches)
  const visibleUserSkills = userSkills.filter(matches)
  const visibleExternalSkills = externalSkills.filter(matches)
  const totalVisible =
    visibleEmployeeSkills.length +
    visibleUserSkills.length +
    visibleOtherBuiltIns.length +
    visibleExternalSkills.length

  if (
    builtInSkills.length === 0 &&
    userSkills.length === 0 &&
    externalSkills.length === 0
  ) {
    return (
      <PickerFrame>
        <div className="px-4 py-5 text-center">
          <p className="font-medium text-foreground text-sm">
            No skills available
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            Install skills via Settings → Skills
          </p>
        </div>
      </PickerFrame>
    )
  }

  if (totalVisible === 0) {
    return (
      <PickerFrame>
        <div className="px-4 py-4 text-center text-muted-foreground text-xs">
          No matching skills — backspace to refine or Esc to dismiss
        </div>
      </PickerFrame>
    )
  }

  const employeeOffset = 0
  const userOffset = visibleEmployeeSkills.length
  const otherOffset = userOffset + visibleUserSkills.length
  const externalOffset = otherOffset + visibleOtherBuiltIns.length

  return (
    <PickerFrame>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <SkillSection
          label="Agent Skills"
          skills={visibleEmployeeSkills}
          offset={employeeOffset}
          selectedIndex={selectedIndex}
          onSelect={onSelect}
          onHover={onHover}
        />
        <SectionDivider
          show={
            visibleEmployeeSkills.length > 0 && visibleUserSkills.length > 0
          }
        />
        <SkillSection
          label="Your Skills"
          skills={visibleUserSkills}
          offset={userOffset}
          selectedIndex={selectedIndex}
          onSelect={onSelect}
          onHover={onHover}
        />
        <SectionDivider
          show={
            (visibleEmployeeSkills.length > 0 ||
              visibleUserSkills.length > 0) &&
            visibleOtherBuiltIns.length > 0
          }
        />
        <SkillSection
          label="More Skills"
          skills={visibleOtherBuiltIns}
          offset={otherOffset}
          selectedIndex={selectedIndex}
          onSelect={onSelect}
          onHover={onHover}
        />
        <SectionDivider
          show={
            (visibleEmployeeSkills.length > 0 ||
              visibleUserSkills.length > 0 ||
              visibleOtherBuiltIns.length > 0) &&
            visibleExternalSkills.length > 0
          }
        />
        <SkillSection
          label="External Skills"
          skills={visibleExternalSkills}
          offset={externalOffset}
          selectedIndex={selectedIndex}
          onSelect={onSelect}
          onHover={onHover}
        />
      </div>
    </PickerFrame>
  )
}

// Outer container + footer. Wraps every render path (loading / empty / list)
// so the empty states keep the same dimensions and the keyboard-hint footer.
function PickerFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex max-h-80 flex-col overflow-hidden rounded-xl border border-border/60 bg-popover shadow-lg ring-1 ring-foreground/5">
      {children}
      <div className="shrink-0 border-border/60 border-t px-3 py-1.5">
        <span className="text-muted-foreground text-xs">
          ↑↓ navigate · Enter select · Esc dismiss
        </span>
      </div>
    </div>
  )
}

interface SkillSectionProps {
  label: string
  skills: PickerSkill[]
  offset: number
  selectedIndex: number
  onSelect: (name: string) => void
  onHover: (index: number) => void
}

function SkillSection({
  label,
  skills,
  offset,
  selectedIndex,
  onSelect,
  onHover,
}: SkillSectionProps) {
  if (skills.length === 0) return null
  return (
    <div className="p-1">
      <p className="px-2 py-1 font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
        {label}
      </p>
      {skills.map((skill, i) => (
        <SkillItem
          key={skill.name}
          skill={skill}
          selected={offset + i === selectedIndex}
          flatIndex={offset + i}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </div>
  )
}

function SectionDivider({ show }: { show: boolean }) {
  if (!show) return null
  return <div className="mx-1 h-px bg-border" />
}

interface SkillItemProps {
  skill: PickerSkill
  selected: boolean
  flatIndex: number
  onSelect: (name: string) => void
  onHover: (index: number) => void
}

function SkillItem({
  skill,
  selected,
  flatIndex,
  onSelect,
  onHover,
}: SkillItemProps) {
  return (
    <button
      type="button"
      data-selected={selected ? 'true' : undefined}
      onMouseEnter={() => onHover(flatIndex)}
      onClick={() => onSelect(skill.name)}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-sm px-3 py-1.5 text-left text-sm outline-none transition-colors',
        'hover:bg-muted data-[selected=true]:bg-muted',
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 left-1 h-[18px] w-0.5 -translate-y-1/2 rounded-full bg-[color:var(--accent-orange)] transition-opacity',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      />
      <code
        className={cn(
          'w-[160px] shrink-0 truncate pl-1 font-mono text-xs',
          selected ? 'font-semibold text-foreground' : 'text-foreground/80',
        )}
      >
        {skill.name}
      </code>
      <span className="min-w-0 truncate text-muted-foreground text-xs">
        {skill.description || '—'}
      </span>
    </button>
  )
}
