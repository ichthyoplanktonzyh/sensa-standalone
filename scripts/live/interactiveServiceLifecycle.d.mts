interface InteractiveService {
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  once(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
}

export function waitForInteractiveServices(
  services: Iterable<readonly [string, InteractiveService]>,
  isStopping: () => boolean,
): Promise<never>;
