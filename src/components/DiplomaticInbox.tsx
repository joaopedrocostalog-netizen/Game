import React, { useMemo, useState } from 'react';
import { Check, Inbox, MessageSquareReply, ShieldAlert, X } from 'lucide-react';
import type { DiplomaticProposal, ProposalDecision } from '../engine/simulation';
import './diplomatic-inbox.css';

type Props = {
  proposals: DiplomaticProposal[];
  entityId: string;
  entityNames: Record<string, string>;
  onResolve: (proposalId: string, decision: ProposalDecision, counterText?: string) => void;
};

const typeLabels: Record<DiplomaticProposal['type'], string> = {
  trade: 'Acordo comercial',
  alliance: 'Aliança',
  technology: 'Cooperação tecnológica',
  ultimatum: 'Exigência diplomática',
};

export function DiplomaticInbox({ proposals, entityId, entityNames, onResolve }: Props) {
  const [counteringId, setCounteringId] = useState<string | null>(null);
  const [counterText, setCounterText] = useState('');

  const incoming = useMemo(
    () => proposals.filter((proposal) => proposal.toId === entityId),
    [proposals, entityId],
  );
  const pending = incoming.filter((proposal) => proposal.status === 'pending');
  const recentResolved = incoming.filter((proposal) => proposal.status !== 'pending').slice(0, 2);

  function sendCounter(proposalId: string) {
    const text = counterText.trim();
    if (!text) return;
    onResolve(proposalId, 'counter', text);
    setCounteringId(null);
    setCounterText('');
  }

  return (
    <div className="diplomatic-inbox">
      <div className="inbox-title">
        <div><Inbox size={15} /><span>CAIXA DIPLOMÁTICA</span></div>
        <b>{pending.length} pendente{pending.length === 1 ? '' : 's'}</b>
      </div>

      {pending.length === 0 ? (
        <div className="inbox-empty">Nenhuma proposta estrangeira aguarda resposta neste momento.</div>
      ) : (
        <div className="proposal-list">
          {pending.slice(0, 3).map((proposal) => {
            const fromName = entityNames[proposal.fromId] ?? proposal.fromId;
            const isCountering = counteringId === proposal.id;
            return (
              <article className={proposal.type === 'ultimatum' ? 'proposal-card ultimatum' : 'proposal-card'} key={proposal.id}>
                <div className="proposal-head">
                  <div>
                    {proposal.type === 'ultimatum' ? <ShieldAlert size={14} /> : <MessageSquareReply size={14} />}
                    <span>{typeLabels[proposal.type]}</span>
                  </div>
                  <time>{String(proposal.createdAt.day).padStart(2, '0')}/{String(proposal.createdAt.month).padStart(2, '0')}/{proposal.createdAt.year}</time>
                </div>
                <strong>{fromName}</strong>
                <p>{proposal.terms}</p>
                <small>{proposal.rationale}</small>

                <div className="proposal-actions">
                  <button className="accept" onClick={() => onResolve(proposal.id, 'accept')}><Check size={13} /> Aceitar</button>
                  <button className="reject" onClick={() => onResolve(proposal.id, 'reject')}><X size={13} /> Recusar</button>
                  <button onClick={() => { setCounteringId(isCountering ? null : proposal.id); setCounterText(''); }}><MessageSquareReply size={13} /> Contraproposta</button>
                </div>

                {isCountering && (
                  <div className="counter-box">
                    <textarea
                      value={counterText}
                      onChange={(event) => setCounterText(event.target.value)}
                      placeholder={`Escreva os novos termos para ${fromName}…`}
                      rows={3}
                    />
                    <button onClick={() => sendCounter(proposal.id)} disabled={!counterText.trim()}>Enviar contraproposta</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {recentResolved.length > 0 && (
        <div className="resolved-list">
          <span>Respostas recentes</span>
          {recentResolved.map((proposal) => (
            <div key={proposal.id}>
              <b>{typeLabels[proposal.type]}</b>
              <em>{proposal.status === 'accepted' ? 'Aceita' : proposal.status === 'rejected' ? 'Recusada' : 'Contraproposta'}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
