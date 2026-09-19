import {
  Component,
  Suspense,
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

const SCREEN_TRANSITION_MS = 320;

interface ScreenMemory {
  readonly scroll: Map<string, number>;
  readonly state: Map<string, unknown>;
}

const ScreenMemoryContext = createContext<ScreenMemory | null>(null);

export function ScreenMemoryProvider({ children }: { readonly children: ReactNode }) {
  const memory = useRef<ScreenMemory | null>(null);
  memory.current ??= { scroll: new Map(), state: new Map() };
  return <ScreenMemoryContext.Provider value={memory.current}>{children}</ScreenMemoryContext.Provider>;
}

function useScreenMemory(): ScreenMemory {
  const memory = useContext(ScreenMemoryContext);
  if (!memory) throw new Error("Screen memory requires ScreenMemoryProvider");
  return memory;
}

/** Persist small, non-authoritative UI choices across a screen's unmount/remount. */
export function useScreenState<Value>(
  key: string,
  initialValue: Value | (() => Value),
): readonly [Value, Dispatch<SetStateAction<Value>>] {
  const memory = useScreenMemory();
  const [value, setValue] = useState<Value>(() => {
    if (memory.state.has(key)) return memory.state.get(key) as Value;
    const initial = typeof initialValue === "function"
      ? (initialValue as () => Value)()
      : initialValue;
    memory.state.set(key, initial);
    return initial;
  });
  const setRememberedValue = useCallback<Dispatch<SetStateAction<Value>>>((next) => {
    setValue((current) => {
      const resolved = typeof next === "function"
        ? (next as (previous: Value) => Value)(current)
        : next;
      memory.state.set(key, resolved);
      return resolved;
    });
  }, [key, memory]);
  return [value, setRememberedValue] as const;
}

type ScreenRenderer = (active: boolean) => ReactNode;

interface ScreenEntry {
  readonly key: string;
  readonly memoryKey: string;
  readonly preserveScroll: boolean;
  readonly render: ScreenRenderer;
}

interface ScreenHostProps {
  readonly active?: boolean;
  readonly children: ScreenRenderer;
  readonly fallback?: ReactNode;
  readonly screenKey: string;
  readonly memoryKey?: string;
  readonly preserveScroll?: boolean;
}

interface ScreenHostState {
  readonly current: ScreenEntry;
  readonly outgoing: ScreenEntry | null;
}

function scrollOwner(slot: HTMLDivElement): HTMLElement | null {
  return slot.querySelector<HTMLElement>("[data-sensa-screen-scroll]")
    ?? slot.querySelector<HTMLElement>(".screen");
}

function ScreenSlot({ entry, active, fallback, phase }: {
  readonly entry: ScreenEntry;
  readonly active: boolean;
  readonly fallback?: ReactNode;
  readonly phase: "current" | "outgoing";
}) {
  const memory = useScreenMemory();
  const slot = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState(false);
  const markResolved = useCallback(() => setResolved(true), []);
  const interactive = active && phase === "current";
  useLayoutEffect(() => {
    const element = slot.current;
    if (!element || !entry.preserveScroll || !resolved || phase !== "current") return;
    const owner = scrollOwner(element);
    if (!owner) return;
    owner.scrollTop = memory.scroll.get(entry.memoryKey) ?? 0;
    const remember = () => memory.scroll.set(entry.memoryKey, owner.scrollTop);
    owner.addEventListener("scroll", remember, { passive: true });
    return () => {
      remember();
      owner.removeEventListener("scroll", remember);
    };
  }, [entry.memoryKey, entry.preserveScroll, memory, phase, resolved]);
  return (
    <div
      ref={slot}
      className={`absolute inset-0 ${phase === "current" ? "z-[1]" : "z-0 pointer-events-none"}`}
      data-sensa-screen-slot={entry.key}
      data-sensa-screen-phase={phase}
      data-sensa-screen-interactive={interactive ? "true" : "false"}
      aria-hidden={!interactive}
      inert={!interactive}
    >
      <Suspense fallback={fallback}>
        <ResolvedScreen onReady={markResolved}>{entry.render(interactive)}</ResolvedScreen>
      </Suspense>
    </div>
  );
}

function ResolvedScreen({ children, onReady }: {
  readonly children: ReactNode;
  readonly onReady: () => void;
}) {
  useLayoutEffect(onReady, [onReady]);
  return children;
}

/**
 * Owns the complete screen lifecycle: one current screen, at most one outgoing
 * screen, explicit interaction ownership, scroll restoration and lazy fallback.
 */
export class ScreenHost extends Component<ScreenHostProps, ScreenHostState> {
  private timer: number | undefined;

  constructor(props: ScreenHostProps) {
    super(props);
    this.state = {
      current: {
        key: props.screenKey,
        memoryKey: props.memoryKey ?? props.screenKey,
        preserveScroll: props.preserveScroll ?? true,
        render: props.children,
      },
      outgoing: null,
    };
  }

  static getDerivedStateFromProps(props: ScreenHostProps, state: ScreenHostState): ScreenHostState {
    const next = {
      key: props.screenKey,
      memoryKey: props.memoryKey ?? props.screenKey,
      preserveScroll: props.preserveScroll ?? true,
      render: props.children,
    };
    return state.current.key === props.screenKey
      ? { ...state, current: next }
      : { current: next, outgoing: state.current };
  }

  componentDidUpdate(previous: ScreenHostProps): void {
    if (previous.screenKey === this.props.screenKey) return;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : SCREEN_TRANSITION_MS;
    const outgoingKey = this.state.outgoing?.key;
    this.timer = window.setTimeout(() => {
      this.setState((state) => state.outgoing?.key === outgoingKey
        ? { ...state, outgoing: null }
        : state);
      this.timer = undefined;
    }, delay);
  }

  componentWillUnmount(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
  }

  render() {
    const active = this.props.active ?? true;
    return <>
      {this.state.outgoing && (
        <ScreenSlot
          key={this.state.outgoing.key}
          entry={this.state.outgoing}
          active={false}
          fallback={this.props.fallback}
          phase="outgoing"
        />
      )}
      <ScreenSlot
        key={this.state.current.key}
        entry={this.state.current}
        active={active}
        fallback={this.props.fallback}
        phase="current"
      />
    </>;
  }
}
