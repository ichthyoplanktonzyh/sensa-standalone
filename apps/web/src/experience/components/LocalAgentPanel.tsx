import '../../i18n/profileResources';
import type {
  SensaAgentClientKind,
  SensaAgentConnectionEvent,
  SensaAgentConnectionSetup,
  SensaAgentConnectionView,
} from '@sensa/contracts/sensa';
import { CheckCircle2, Copy, Link2, RefreshCw, RotateCw, Trash2, Unplug } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createAgentConnectionSetup,
  listAgentConnectionEvents,
  listAgentConnections,
  revokeAgentConnection,
} from '../../data/library/agentConnection';
import { useAccountExperience } from '../account/AccountContext';
import { agentSetupCommand, agentUninstallCommand } from '../account/localAgentSetup';

const clients: { kind: SensaAgentClientKind; label: string }[] = [
  { kind: 'codex', label: 'Codex' },
  { kind: 'cursor', label: 'Cursor' },
  { kind: 'claude_desktop', label: 'Claude Desktop' },
  { kind: 'windsurf', label: 'Windsurf' },
  { kind: 'cli', label: 'CLI' },
];

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
  const { onlineService } = useAccountExperience();
  const [connections, setConnections] = useState<SensaAgentConnectionView[]>([]);
  const [events, setEvents] = useState<SensaAgentConnectionEvent[]>([]);
  const [setup, setSetup] = useState<SensaAgentConnectionSetup | null>(null);
  const [clientKind, setClientKind] = useState<SensaAgentClientKind>('codex');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'creating' | 'revoking' | 'failed'>('idle');
  const [copied, setCopied] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!onlineService) { setConnections([]); setEvents([]); setPhase('idle'); return; }
    setPhase('loading');
    try {
      const [nextConnections, nextEvents] = await Promise.all([
        listAgentConnections(),
        listAgentConnectionEvents(),
      ]);
      setConnections(nextConnections);
      setEvents(nextEvents);
      setPhase('idle');
    } catch { setPhase('failed'); }
  }, [onlineService]);
  useEffect(() => { void load(); }, [load]);

  const command = useMemo(() => {
    const apiUrl = import.meta.env.VITE_SENSA_API_URL as string | undefined;
    return setup && apiUrl ? agentSetupCommand({ origin: location.origin, apiUrl, setup }) : null;
  }, [setup]);
  const create = async (replaces?: SensaAgentConnectionView) => {
    const selected = replaces?.clientKind ?? clientKind;
    const label = replaces?.label ?? clients.find((client) => client.kind === selected)!.label;
    setPhase('creating');
    setCopied(null);
    try {
      setSetup(await createAgentConnectionSetup({
        clientKind: selected,
        label,
        replacesConnectionId: replaces?.connectionId,
      }));
      setPhase('idle');
      await load();
    } catch { setPhase('failed'); }
  };
  const revoke = async (connection: SensaAgentConnectionView) => {
    if (!window.confirm(t('account.agentRevokeConfirm', { label: connection.label }))) return;
    setPhase('revoking');
    try {
      await revokeAgentConnection(connection.connectionId);
      setSetup((current) => current?.replacesConnectionId === connection.connectionId ? null : current);
      await load();
    } catch { setPhase('failed'); }
  };
  const copy = async (value: string, key: string) => {
    try { await copyText(value); setCopied(key); }
    catch { setCopied(null); setPhase('failed'); }
  };
  const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border-strong bg-surface-panel px-4 py-2 text-sm font-medium text-action-primary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50';
  const busy = phase === 'loading' || phase === 'creating' || phase === 'revoking';
  const eventLabel = (event: SensaAgentConnectionEvent) => t(`account.agentEvent_${event.eventType}`, { label: event.label });

  return <section className="space-y-5 rounded-card border border-border-subtle bg-surface-panel p-5 sm:p-6">
    {!onlineService ? <p role="status" className="text-sm text-fg-secondary">{t('account.agentSignInRequired')}</p> : <>
      <div className="flex items-start gap-3">
        <Link2 aria-hidden="true" size={20} className="mt-0.5 text-action-primary"/>
        <div>
          <p className="font-medium text-fg-primary">{t('account.agentConnectionTitle')}</p>
          <p className="mt-1 text-sm leading-6 text-fg-secondary">{t('account.agentConnectionNote')}</p>
        </div>
      </div>

      {setup && command && <div className="rounded-control border border-feedback-success bg-accent-soft p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-feedback-success">
          <CheckCircle2 aria-hidden="true" size={18}/>{t('account.agentSetupReady')}
        </div>
        <p className="mt-2 text-sm leading-6 text-fg-secondary">
          {t('account.agentSetupOnce', { date: new Date(setup.expiresAt).toLocaleTimeString() })}
        </p>
        <button className={`${button} mt-4`} onClick={() => void copy(command, 'setup')}>
          <Copy aria-hidden="true" size={16}/>{t(copied === 'setup' ? 'account.agentCopied' : 'account.agentCopySetup')}
        </button>
        {copied === 'setup' && <p className="mt-3 text-xs text-fg-tertiary">{t('account.agentRunCommand')}</p>}
      </div>}

      <div>
        <label className="block text-sm font-medium text-fg-primary" htmlFor="sensa-agent-client">{t('account.agentClient')}</label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <select
            id="sensa-agent-client"
            className="min-h-11 rounded-control border border-border-strong bg-surface-panel px-3 text-sm text-fg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            value={clientKind}
            disabled={busy}
            onChange={(event) => setClientKind(event.target.value as SensaAgentClientKind)}
          >
            {clients.map((client) => <option key={client.kind} value={client.kind}>{client.label}</option>)}
          </select>
          <button className={button} disabled={busy} onClick={() => void create()}>
            <Link2 aria-hidden="true" size={16}/>{t('account.agentCreateConnection')}
          </button>
          <button className={button} disabled={busy} onClick={() => void load()}>
            <RefreshCw aria-hidden="true" size={16}/>{t('account.agentRetry')}
          </button>
        </div>
        {phase === 'failed' && <p role="status" className="mt-3 text-sm text-feedback-danger">{t('account.agentFailed')}</p>}
      </div>

      <div>
        <p className="text-sm font-medium text-fg-primary">{t('account.agentConnections')}</p>
        {connections.length === 0 ? <p className="mt-2 text-sm text-fg-secondary">{t('account.agentNoConnections')}</p> : <ul className="mt-3 divide-y divide-border-subtle rounded-control border border-border-subtle">
          {connections.map((connection) => {
            const uninstall = agentUninstallCommand({ origin: location.origin, clientKind: connection.clientKind, connectionId: connection.connectionId });
            return <li key={connection.connectionId} className="space-y-3 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg-primary">{connection.label}</p>
                  <p className="mt-1 text-xs text-fg-tertiary">{t(`account.agentState_${connection.state}`)} · {t('account.agentExpires', { date: new Date(connection.expiresAt).toLocaleDateString() })}</p>
                  <p className="mt-1 text-xs text-fg-tertiary">{connection.lastUsedAt ? t('account.agentLastUsed', { date: new Date(connection.lastUsedAt).toLocaleString() }) : t('account.agentNeverUsed')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {connection.state === 'active' && <button className={button} disabled={busy} onClick={() => void create(connection)}>
                    <RotateCw aria-hidden="true" size={16}/>{t('account.agentReplace')}
                  </button>}
                  <button className={button} disabled={busy} onClick={() => void copy(uninstall, `uninstall:${connection.connectionId}`)}>
                    <Unplug aria-hidden="true" size={16}/>{t(copied === `uninstall:${connection.connectionId}` ? 'account.agentCopied' : 'account.agentCopyUninstall')}
                  </button>
                  {connection.state === 'active' && <button className={button} disabled={busy} onClick={() => void revoke(connection)}>
                    <Trash2 aria-hidden="true" size={16}/>{t('account.agentRevoke')}
                  </button>}
                </div>
              </div>
            </li>;
          })}
        </ul>}
      </div>

      <div>
        <p className="text-sm font-medium text-fg-primary">{t('account.agentAudit')}</p>
        {events.length === 0 ? <p className="mt-2 text-sm text-fg-secondary">{t('account.agentNoAudit')}</p> : <ul className="mt-2 space-y-1">
          {events.slice(0, 8).map((event) => <li key={event.eventId} className="text-xs leading-5 text-fg-tertiary">
            {eventLabel(event)} · {new Date(event.createdAt).toLocaleString()}
          </li>)}
        </ul>}
      </div>
    </>}
  </section>;
}
