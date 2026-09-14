import React, { useEffect, useState } from 'react';
import {
  adoptAirDoctrine,
  airDoctrineFor,
  doctrineAvailable,
  doctrineLabel,
  processAirDoctrine,
  type AirDoctrineSchool,
} from '../engine/airDoctrine';
import type { SimulationState } from '../engine/simulation';
import './air-doctrine.css';

type Props = { entityId: string; simulation: SimulationState };

const schools: AirDoctrineSchool[] = ['balanced', 'air-defense', 'air-superiority', 'tactical-support', 'interdiction', 'maritime-aviation', 'air-mobility'];

function band(value: number) {
  if (value < 25) return 'EM FORMAÇÃO';
  if (value < 45) return 'LIMITADA';
  if (value < 65) return 'MADURA';
  if (value < 82) return 'AVANÇADA';
  return 'EXCEPCIONAL';
}

function description(school: AirDoctrineSchool) {
  if (school === 'balanced') return 'Mantém flexibilidade entre missões, sem concentrar treinamento em uma única forma de emprego.';
  if (school === 'air-defense') return 'Prioriza proteção do espaço aéreo, interceptação e resistência defensiva.';
  if (school === 'air-superiority') return 'Concentra treinamento e comando em conquistar e manter liberdade de ação no ar.';
  if (school === 'tactical-support') return 'Aprofunda integração com forças terrestres e reconhecimento próximo da frente.';
  if (school === 'interdiction') return 'Especializa a força em pressionar comunicações, bases e sustentação operacional adversária.';
  if (school === 'maritime-aviation') return 'Integra poder aéreo a patrulha marítima e operações navais.';
  return 'Prioriza transporte, sustentação rápida e mobilidade aérea de forças e suprimentos.';
}

export function AirDoctrinePanel({ entityId, simulation }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-air-doctrine', refresh);
    return () => window.removeEventListener('world-state-air-doctrine', refresh);
  }, []);

  useEffect(() => {
    const result = processAirDoctrine(simulation);
    if (result.changed) setRevision((value) => value + 1);
  }, [simulation.elapsedDays]);

  void revision;
  if (simulation.date.year < 1794) return null;
  const profile = airDoctrineFor(entityId, simulation);
  const available = schools.filter((school) => doctrineAvailable(simulation.date.year, school));

  function adopt(school: AirDoctrineSchool) {
    const result = adoptAirDoctrine(entityId, school, simulation);
    if (!result.profile) {
      setMessage(result.error ?? 'Não foi possível adotar a doutrina.');
      return;
    }
    Object.assign(simulation.entities, result.simulation.entities);
    simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    setMessage(`${doctrineLabel(school, simulation.date.year)} adotada. A força precisará absorver a nova escola antes de atingir plena proficiência.`);
    setRevision((value) => value + 1);
  }

  return <section className="air-doctrine-panel">
    <header className="air-doctrine-heading">
      <div><span>DOUTRINA AÉREA</span><strong>{doctrineLabel(profile.school, simulation.date.year)}</strong></div>
      <em>{band(profile.mastery)}</em>
    </header>

    <div className="air-doctrine-stats">
      <span><small>Proficiência doutrinária</small><b>{band(profile.mastery)}</b></span>
      <span><small>Flexibilidade</small><b>{band(profile.flexibility)}</b></span>
      <span><small>Integração conjunta</small><b>{band(profile.jointIntegration)}</b></span>
    </div>

    <div className="air-doctrine-grid">
      {available.map((school) => <article className={profile.school === school ? 'active' : ''} key={school}>
        <div><b>{doctrineLabel(school, simulation.date.year)}</b><small>{description(school)}</small></div>
        <button disabled={profile.school === school} onClick={() => adopt(school)}>{profile.school === school ? 'Em vigor' : 'Adotar escola'}</button>
      </article>)}
    </div>

    {message && <div className="air-doctrine-message">{message}</div>}
    <small className="air-doctrine-note">A doutrina não cria poder aéreo sozinha. Ela altera como treinamento, comando e experiência são convertidos em eficiência por missão. Trocas doutrinárias reduzem temporariamente a proficiência e exigem tempo para maturação institucional.</small>
  </section>;
}
