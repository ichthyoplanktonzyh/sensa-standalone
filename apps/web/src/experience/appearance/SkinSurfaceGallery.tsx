import { Check, CircleAlert, CircleCheck, Info, Moon, Sun } from "lucide-react";
import { componentSlot } from "./componentContract";
import { colorModeCatalog, skinCatalog, textSizeCatalog, type ColorModePreference, type TextSizePreference } from "./contract";
import { updateAppearancePreference, useAppearancePreference } from "./store";
import {
  SensaAction,
  SensaChoice,
  SensaFeedback,
  SensaField,
  SensaLearningSurface,
  SensaNavigation,
  SensaOverlayFrame,
  SensaSurface,
} from "../ui/SensaComponents";

const sectionTitle = "mb-4 text-section-title font-semibold";
const specimenGrid = "grid gap-4 md:grid-cols-2 xl:grid-cols-3";

function Specimen({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <SensaSurface as="section" variant="card">
      <h2 className={sectionTitle}>{title}</h2>
      {children}
    </SensaSurface>
  );
}

export function SkinSurfaceGallery() {
  const preference = useAppearancePreference();
  return (
    <main data-sensa-skin-lab className="min-h-screen bg-surface-canvas px-4 py-6 text-fg-primary sm:px-8 lg:px-12">
      <div className="mx-auto grid max-w-7xl gap-6">
        <header className="flex flex-col gap-4 border-b border-border-subtle pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-metadata font-semibold uppercase tracking-[0.12em] text-fg-tertiary">Development-only surface</p>
            <h1 className="mt-2 text-page-title font-semibold">Sensa Skin Lab</h1>
            <p className="mt-2 max-w-2xl text-body-support text-fg-secondary">
              Component contract preview. Examples below are presentation fixtures only and do not represent learner state, evidence, progress, or sync results.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Appearance controls">
            {skinCatalog.map((skin) => (
              <SensaChoice
                key={skin.id}
                variant="chip"
                selected={preference.skin === skin.id}
                onClick={() => updateAppearancePreference({ skin: skin.id })}
              >
                {skin.id === "quiet" ? "Quiet" : "Clear"}
              </SensaChoice>
            ))}
            {colorModeCatalog.filter((mode) => mode !== "system").map((mode) => (
              <SensaChoice
                key={mode}
                variant="chip"
                selected={preference.colorMode === mode}
                onClick={() => updateAppearancePreference({ colorMode: mode as ColorModePreference })}
              >
                {mode === "light" ? <Sun aria-hidden size={15} /> : <Moon aria-hidden size={15} />}
                {mode}
              </SensaChoice>
            ))}
            {textSizeCatalog.map((size) => (
              <SensaChoice
                key={size}
                variant="chip"
                selected={preference.textSize === size}
                onClick={() => updateAppearancePreference({ textSize: size as TextSizePreference })}
              >
                {size}
              </SensaChoice>
            ))}
          </div>
        </header>

        <div className={specimenGrid}>
          <Specimen title="Actions">
            <div className="flex flex-wrap gap-3">
              <SensaAction variant="primary">Primary action</SensaAction>
              <SensaAction variant="secondary">Secondary</SensaAction>
              <SensaAction variant="quiet">Quiet</SensaAction>
              <SensaAction variant="danger">Danger</SensaAction>
              <SensaAction variant="primary" loading>Loading</SensaAction>
              <SensaAction variant="secondary" disabled>Disabled</SensaAction>
            </div>
          </Specimen>

          <Specimen title="Fields">
            <div className="grid gap-4">
              <SensaField label="Expression" help="Label and help remain part of the component anatomy." inputProps={{ placeholder: "Enter an expression" }} />
              <SensaField label="Required field" error="Example validation message" inputProps={{ defaultValue: "" }} />
            </div>
          </Specimen>

          <Specimen title="Selection">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Selection examples">
              <SensaChoice variant="choice" selected>Selected choice</SensaChoice>
              <SensaChoice variant="choice">Choice</SensaChoice>
              <SensaChoice variant="tab" selected>Active tab</SensaChoice>
              <SensaChoice variant="chip">Chip</SensaChoice>
            </div>
          </Specimen>

          <Specimen title="Surfaces">
            <div className="grid gap-3">
              <SensaSurface variant="card"><strong>Card</strong><p className="mt-1 text-sm text-fg-secondary">Contained without assumed elevation.</p></SensaSurface>
              <SensaSurface variant="raised"><strong>Raised</strong><p className="mt-1 text-sm text-fg-secondary">Elevation is supplied by the adapter.</p></SensaSurface>
              <SensaSurface variant="media"><strong>Media stage</strong><p className="mt-1 text-sm opacity-80">Always-dark paired foreground.</p></SensaSurface>
            </div>
          </Specimen>

          <Specimen title="Feedback">
            <div className="grid gap-3">
              <SensaFeedback variant="success" icon={<CircleCheck aria-hidden size={18} />}>Success presentation example</SensaFeedback>
              <SensaFeedback variant="warning" icon={<CircleAlert aria-hidden size={18} />}>Warning presentation example</SensaFeedback>
              <SensaFeedback variant="danger" icon={<CircleAlert aria-hidden size={18} />}>Error presentation example</SensaFeedback>
              <SensaFeedback variant="info" icon={<Info aria-hidden size={18} />}>Informational presentation example</SensaFeedback>
            </div>
          </Specimen>

          <Specimen title="Navigation">
            <div className="grid gap-3">
              <SensaNavigation variant="bar" aria-label="Bar specimen">
                <span {...componentSlot<"navigation">("leading")}>Back</span>
                <strong {...componentSlot<"navigation">("title")}>Surface title</strong>
                <span {...componentSlot<"navigation">("trailing")}>More</span>
              </SensaNavigation>
              <SensaNavigation variant="tabs" aria-label="Tabs specimen">
                <span>Overview</span><strong>Learning</strong><span>History</span>
              </SensaNavigation>
            </div>
          </Specimen>
        </div>

        <SensaSurface as="section" variant="raised">
          <h2 className={sectionTitle}>Learning runtime presentation states</h2>
          <div className={specimenGrid}>
            {(["prompt", "response", "reveal", "assessment", "completion"] as const).map((variant) => (
              <SensaLearningSurface key={variant} variant={variant}>
                <span {...componentSlot<"learning">("eyebrow")}>{variant} contract</span>
                <strong {...componentSlot<"learning">("expression")}>take your time</strong>
                <span {...componentSlot<"learning">("sense")}>允许对方从容完成，不必着急</span>
                <span {...componentSlot<"learning">("support")}>Static Skin Lab copy; no learning event or outcome is created.</span>
                <span {...componentSlot<"learning">("actions")} className="flex items-center gap-2 text-sm">
                  <Check aria-hidden size={16} /> Stable anatomy and semantics
                </span>
              </SensaLearningSurface>
            ))}
          </div>
        </SensaSurface>

        <SensaSurface as="section" variant="card">
          <h2 className={sectionTitle}>Overlays</h2>
          <div className={specimenGrid}>
            {(["dialog", "sheet", "popover"] as const).map((variant) => (
              <SensaOverlayFrame key={variant} variant={variant} title={`${variant} frame`}>
                Static anatomy preview. Focus management and dismissal remain owned by the product component.
              </SensaOverlayFrame>
            ))}
          </div>
        </SensaSurface>
      </div>
    </main>
  );
}
