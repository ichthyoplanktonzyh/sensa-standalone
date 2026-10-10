/** Keep intentional cleanup distinct from a failed interactive acceptance service.
 * The caller owns cleanup; this promise only reports unexpected service exits. */
export function waitForInteractiveServices(services, isStopping) {
  return new Promise((_, reject) => {
    for (const [name, child] of services) {
      const failed = (code, signal) => {
        if (isStopping()) return;
        reject(new Error(`Interactive ${name} exited (${code ?? signal}); acceptance is not complete.`));
      };
      if (child.exitCode !== null || child.signalCode !== null) failed(child.exitCode, child.signalCode);
      else child.once('exit', failed);
    }
  });
}
