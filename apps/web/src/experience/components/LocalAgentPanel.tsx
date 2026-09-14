import { CheckCircle2, Copy, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SensaLocalAgentConnectionStatus } from '@sensa/contracts/sensa';

import { openLibrary } from '../../data/library/store';
import { localAgentBridge } from '../account/localAgentBridge';
import { detectLocalAgentEnvironment, localAgentSetupCommand } from '../account/localAgentSetup';

type State =
  | { phase: 'checking' }
  | { phase: 'extension_missing' }
  | { phase: 'failed' }
  | { phase: 'available'; status: SensaLocalAgentConnectionStatus; libraryId: string };

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return; }
  const field = document.createElement('textarea');
  field.value = value;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('clipboard_unavailable');
}

export function LocalAgentPanel() {
  const { t } = useTranslation();
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ phase: 'checking' });
  const [copied, setCopied] = useState(false);
  const check = useCallback(async () => {
    const current = ++generation.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setState({ phase: 'checking' });
    try {
      const libraryId = (await openLibrary()).id;
      const status = await localAgentBridge('web-native-intake-status', libraryId, request.signal, {});
      if (current === generation.current) setState({ phase: 'available', status, libraryId });
    } catch (error) {
      if (current !== generation.current) return;
      setState({
        phase: error instanceof Error && error.message === 'extension_unavailable'
          ? 'extension_missing'
          : 'failed',
      });
    }
  }, []);
  useEffect(() => {
    void check();
    const focused = () => void check();
    window.addEventListener('focus', focused);
    return () => { generation.current++; controller.current?.abort(); window.removeEventListener('focus', focused); };
  }, [check]);

  const environment = useMemo(() => detectLocalAgentEnvironment(navigator.userAgent), []);
  const needsSetup = state.phase === 'available' && state.status.state !== 'connected';
  const command = needsSetup && environment ? localAgentSetupCommand({
    origin: location.origin,
    libraryId: state.libraryId,
    extensionId: state.status.extensionId,
    environment,
    label: import.meta.env.VITE_SENSA_LOCAL_AGENT_LABEL,
  }) : null;
  const copy = async () => {
    if (!command) return;
    try { await copyText(command); setCopied(true); }
    catch { setCopied(false); setState({ phase: 'failed' }); }
  };
  const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#cbd3e1] bg-white px-4 py-2 text-sm font-medium text-[#405780] hover:bg-[#edf0f7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5268a9] disabled:opacity-50';

  const status = state.phase === 'checking'
    ? t('account.agentChecking')
    : state.phase === 'extension_missing'
      ? t('account.agentExtensionMissing')
      : state.phase === 'failed'
        ? t('account.agentFailed')
        : state.status.state === 'connected'
          ? t('account.agentConnected', { label: state.status.clientLabel ?? 'Codex' })
          : state.status.state === 'different_library'
            ? t('account.agentDifferentLibrary')
            : t('account.agentSetupRequired');

  return <section className="rounded-2xl border border-[#d8deea] bg-white p-5 sm:p-6">
    <div className="flex items-center gap-3">
      {state.phase === 'available' && state.status.state === 'connected' && <CheckCircle2 aria-hidden="true" size={20} className="text-emerald-700"/>}
      <p role="status" aria-live="polite" className="text-sm text-[#4d5c75]">{status}</p>
    </div>
    {needsSetup && !environment && <p className="mt-4 text-sm text-[#68748d]">{t('account.agentUnsupported')}</p>}
    <div className="mt-5 flex flex-wrap gap-3">
      {command && <button className={button} onClick={() => void copy()}><Copy aria-hidden="true" size={16}/>{t(copied ? 'account.agentCopied' : 'account.agentCopySetup')}</button>}
      <button className={button} disabled={state.phase === 'checking'} onClick={() => { setCopied(false); void check(); }}><RefreshCw aria-hidden="true" size={16}/>{t('account.agentRetry')}</button>
    </div>
    {command && copied && <p className="mt-3 text-xs text-[#788398]">{t('account.agentRunCommand')}</p>}
  </section>;
}
