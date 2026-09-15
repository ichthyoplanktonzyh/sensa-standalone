import { Check, CircleAlert, CircleCheck, Info, Moon, Sun } from "lucide-react";
import type { CSSProperties } from "react";
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
import { SensaApplicationShellLayout, SensaCollectionBrowserLayout, SensaDetailWorkspaceLayout, SensaPageLayout, SensaWorkspacePageLayout } from "../ui/SensaPageLayouts";

const sectionTitle = "mb-4 text-section-title font-semibold";
const specimenGrid = "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3";

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
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6">
        <header className="flex min-w-0 flex-col gap-4 border-b border-border-subtle pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="break-words text-metadata font-semibold uppercase tracking-[0.12em] text-fg-tertiary">Development-only surface</p>
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
          <h2 className={sectionTitle}>Application shell layout contract</h2>
          <p className="mb-4 max-w-3xl text-body-support text-fg-secondary">
            Product Shell owns one brand, navigation, utilities, and viewport tree. Quiet presents a wide-screen top bar; Clear presents a sidebar; both adapt to touch-sized mobile chrome.
          </p>
          <SensaApplicationShellLayout
            mode="specimen"
            data-sensa-contract-specimen="full"
            aria-label="Application shell layout specimen"
            regions={{
              chrome: {
                brand: (
                  <button type="button" data-sensa-shell-brand-action aria-label="Fixture home">
                    <span data-sensa-shell-brand-mark aria-hidden="true"><i/><i/></span>
                    <span data-sensa-shell-brand-word>sensa</span>
                  </button>
                ),
                navigation: (
                  <nav
                    data-sensa-shell-navigation
                    aria-label="Fixture primary navigation"
                    style={{ '--sensa-shell-navigation-count': 3 } as CSSProperties}
                  >
                    {['Home', 'Meanings', 'Learning'].map((label, index) => (
                      <button type="button" data-sensa-shell-navigation-item data-selected={index === 0 ? '' : undefined} key={label}>
                        <span data-sensa-shell-item-icon aria-hidden>{index + 1}</span>
                        <span data-sensa-shell-item-label>{label}</span>
                      </button>
                    ))}
                  </nav>
                ),
                utilities: (
                  <div data-sensa-shell-utilities>
                    <button type="button" data-sensa-shell-utility-action>
                      <span aria-hidden>⚙</span>
                      <span data-sensa-shell-utility-label>Settings</span>
                    </button>
                  </div>
                ),
              },
              viewport: (
                <div className="absolute inset-0 overflow-auto p-5 sm:p-8">
                  <SensaSurface variant="raised" className="mx-auto max-w-2xl">
                    <span className="text-metadata uppercase tracking-wide text-fg-tertiary">Viewport region</span>
                    <h3 className="mt-2 text-section-title font-semibold">The route and screen stack remain Product Shell state.</h3>
                    <p className="mt-2 text-body-support text-fg-secondary">Only the surrounding spatial composition changes with the active Skin.</p>
                    <SensaField
                      className="mt-5"
                      label="Shell state-preservation probe"
                      help="Browser validation keeps this DOM node connected while switching Skin."
                      inputProps={{ id: "skin-shell-state-probe", defaultValue: "Persistent shell input" }}
                    />
                  </SensaSurface>
                </div>
              ),
            }}
          />
          <SensaApplicationShellLayout
            mode="specimen"
            data-sensa-shell-focus-probe
            style={{ minHeight: "10rem" }}
            aria-label="Focused application shell specimen"
            regions={{
              viewport: (
                <div className="absolute inset-0 grid place-items-center p-5 text-center text-body-support">
                  Focused viewport remains visible without application chrome.
                </div>
              ),
            }}
          />
        </SensaSurface>

        <SensaSurface as="section" variant="card">
          <h2 className={sectionTitle}>Learning runtime layout contract</h2>
          <p className="mb-4 max-w-3xl text-body-support text-fg-secondary">
            One semantic region tree, arranged by the active Skin. Change the Skin above to compare Quiet’s centered reading flow with Clear’s wide-screen sidebar topology.
          </p>
          <SensaPageLayout
            family="learning-runtime"
            mode="specimen"
            data-sensa-contract-specimen="full"
            aria-label="Learning runtime layout specimen"
            regions={{
              header: (
                <>
                  <span className="text-metadata uppercase tracking-wide text-fg-tertiary">Learning runtime</span>
                  <strong className="text-control-label">Meaning recall</strong>
                </>
              ),
              tools: <SensaAction variant="quiet">Pause</SensaAction>,
              progress: (
                <div role="progressbar" aria-label="Fixture progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={42}>
                  <svg className="h-full w-full" viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true">
                    <rect width="42" height="1" className="fill-progress" />
                  </svg>
                </div>
              ),
              primary: (
                <SensaLearningSurface variant="prompt">
                  <span {...componentSlot<"learning">("eyebrow")}>Primary region</span>
                  <strong {...componentSlot<"learning">("expression")}>take your time</strong>
                  <span {...componentSlot<"learning">("sense")}>同一语义内容，不同空间表达</span>
                  <SensaField
                    label="State-preservation probe"
                    help="Browser validation keeps this value connected while switching Skin."
                    inputProps={{ id: "skin-layout-state-probe", defaultValue: "Uncommitted learner input" }}
                  />
                </SensaLearningSurface>
              ),
              supporting: (
                <div>
                  <strong className="text-control-label">Supporting region</strong>
                  <p className="mt-2 text-body-support text-fg-secondary">May move beside or below primary content; when supplied by Product Shell, Skin cannot remove it.</p>
                </div>
              ),
              feedback: <SensaFeedback variant="info">Presentation fixture; no result is recorded.</SensaFeedback>,
              controls: (
                <>
                  <SensaAction variant="secondary">Review</SensaAction>
                  <SensaAction variant="primary">Continue</SensaAction>
                </>
              ),
            }}
          />
        </SensaSurface>

        <SensaSurface as="section" variant="card">
          <h2 className={sectionTitle}>Workspace page layout contract</h2>
          <p className="mb-4 max-w-3xl text-body-support text-fg-secondary">
            Home, learning overview, and settings keep one product-owned header and primary workspace while the active Skin owns measure, gutters, and vertical rhythm.
          </p>
          <SensaWorkspacePageLayout
            mode="specimen"
            measure="wide"
            data-sensa-contract-specimen="full"
            aria-label="Workspace page layout specimen"
            regions={{
              header: (
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <span className="text-metadata uppercase tracking-wide text-fg-tertiary">Workspace header</span>
                    <h3 className="mt-2 text-page-title font-semibold">Today</h3>
                  </div>
                  <SensaAction variant="secondary">Preferences</SensaAction>
                </div>
              ),
              primary: (
                <div className="grid gap-4 md:grid-cols-2">
                  <SensaSurface variant="raised"><strong>Primary workspace</strong><p className="mt-2 text-body-support text-fg-secondary">Product state and content remain mounted.</p></SensaSurface>
                  <SensaSurface variant="card"><strong>Supporting content</strong><p className="mt-2 text-body-support text-fg-secondary">Skin controls the shared page frame only.</p></SensaSurface>
                </div>
              ),
            }}
          />
        </SensaSurface>

        <SensaSurface as="section" variant="card">
          <h2 className={sectionTitle}>Collection browser layout contract</h2>
          <p className="mb-4 max-w-3xl text-body-support text-fg-secondary">
            Navigation, query controls, and results keep their product semantics while each Skin resolves the browser measure and responsive region rhythm.
          </p>
          <SensaCollectionBrowserLayout
            mode="specimen"
            measure="narrow"
            data-sensa-contract-specimen="full"
            aria-label="Collection browser layout specimen"
            regions={{
              header: <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-page-title font-semibold">My meanings</h3><SensaAction variant="primary">Add</SensaAction></div>,
              navigation: <div className="flex gap-5 border-b border-border-subtle"><strong className="py-3 text-action-primary">Personal</strong><span className="py-3 text-fg-secondary">Learning</span></div>,
              controls: <SensaField label="Search this collection" inputProps={{ placeholder: "Expression or meaning" }} />,
              collection: (
                <div className="divide-y divide-border-subtle border-y border-border-subtle">
                  {["take your time", "make room", "hold that thought"].map((label) => <div className="py-5" key={label}><strong>{label}</strong><p className="mt-1 text-body-support text-fg-secondary">Static collection fixture</p></div>)}
                </div>
              ),
            }}
          />
        </SensaSurface>

        <SensaSurface as="section" variant="card">
          <h2 className={sectionTitle}>Detail workspace layout contract</h2>
          <p className="mb-4 max-w-3xl text-body-support text-fg-secondary">
            Product navigation and detail content stay mounted while a Skin may present the workspace as a measured page or a contained edge panel.
          </p>
          <SensaDetailWorkspaceLayout
            mode="specimen"
            measure="narrow"
            data-sensa-contract-specimen="full"
            aria-label="Detail workspace layout specimen"
            regions={{
              header: <div className="flex items-center justify-between gap-3 px-5 py-4"><SensaAction variant="quiet">Back</SensaAction><strong>Meaning detail</strong><span aria-hidden>☆</span></div>,
              primary: (
                <SensaSurface variant="raised">
                  <span className="text-metadata uppercase tracking-wide text-fg-tertiary">Confirmed meaning</span>
                  <h3 className="mt-3 font-language text-learning-expression">take your time</h3>
                  <p className="mt-3 text-body-support text-fg-secondary">One stable detail tree; only its page frame changes.</p>
                </SensaSurface>
              ),
            }}
          />
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
