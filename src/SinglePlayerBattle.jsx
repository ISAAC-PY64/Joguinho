import React, { useRef, useState } from "react";
import { abilities, creatureById } from "./data/creatures.js";
import CreatureArt from "./CreatureArt.jsx";
import { resolveSinglePlayerRound } from "./systems/singlePlayerBattle.js";
import "./styles/singleplayer-battle.css";

const initialChoice = () => ({
  actionType: "attack",
  attackRegion: "upper",
  defendRegion: "upper",
  targetIndex: null
});

function TeamMember({ creature, active }) {
  const species = creatureById(creature.speciesId);
  return (
    <div className={`sp-team-member${active ? " active" : ""}${creature.hp <= 0 ? " defeated" : ""}`}>
      <span><CreatureArt speciesId={creature.speciesId} stage={creature.stage} emoji={species?.emoji}/></span>
      <div>
        <b>{creature.name}</b>
        <small>HP {creature.hp}/{creature.maxHp}</small>
      </div>
    </div>
  );
}

function Combatant({ player, side }) {
  const active = player.team[player.active];
  const species = creatureById(active.speciesId);
  const health = Math.max(0, (active.hp / active.maxHp) * 100);
  return (
    <div className={`sp-combatant ${side}`}>
      <span className="sp-fighter"><CreatureArt speciesId={active.speciesId} stage={active.stage} emoji={species?.emoji}/></span>
      <b>{active.name}</b>
      <small>{player.name} · HP {active.hp}/{active.maxHp}</small>
      <div className="health"><i style={{ width: `${health}%` }} /></div>
      <div className="sp-team">
        {player.team.map((creature, index) => (
          <TeamMember key={creature.id} creature={creature} active={index === player.active} />
        ))}
      </div>
    </div>
  );
}

function ChoiceGroup({ title, options, value, onChange }) {
  return (
    <fieldset className="sp-choice-group">
      <legend>{title}</legend>
      <div className="sp-choice-options">
        {options.map(({ value: option, label }) => (
          <button
            type="button"
            key={option}
            className={value === option ? "secondary selected" : "secondary"}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export default function SinglePlayerBattle({ battle, onBattleChange, onResult, onBack, setToast }) {
  const [choice, setChoice] = useState(initialChoice);
  const resolving = useRef(false);
  const resultHandled = useRef(false);
  const player = battle.players[0];
  const machine = battle.players[1];
  const active = player.team[player.active];
  const switchTargets = player.team
    .map((creature, index) => ({ creature, index }))
    .filter(({ creature, index }) => index !== player.active && creature.hp > 0);
  const canSubmit = !battle.finished && (choice.actionType !== "switch" || Number.isInteger(choice.targetIndex));
  const resultText = battle.draw ? "Empate!" : battle.winnerId === player.playerId ? "Vitória!" : "Derrota";

  const confirmRound = () => {
    if (!canSubmit || resolving.current) return;
    resolving.current = true;
    try {
      const next = resolveSinglePlayerRound(battle, choice);
      onBattleChange(next);
      setChoice(initialChoice());
      if (next.finished && !next.draw && !resultHandled.current) {
        resultHandled.current = true;
        onResult(next.winnerId === player.playerId);
      }
    } catch (error) {
      setToast(error.message);
    } finally {
      resolving.current = false;
    }
  };

  return (
    <div className="battle-board">
      <div className="battle-top">
        <span>ARENA DO SANTUÁRIO</span>
        <b>{battle.finished ? "PARTIDA ENCERRADA" : `ESCOLHAS SIMULTÂNEAS · RODADA ${battle.turnNumber}`}</b>
      </div>
      <div className="sp-combatants">
        <Combatant player={machine} side="machine" />
        <div className="versus">VS</div>
        <Combatant player={player} side="player" />
      </div>

      {!battle.finished ? (
        <div className="sp-round-panel">
          <h3>Escolha suas ações para esta rodada</h3>
          <p className="muted">A máquina também escolherá ataque e defesa. As escolhas só serão reveladas após a confirmação.</p>
          <div className="sp-choice-grid">
            <ChoiceGroup
              title="Onde vai golpear?"
              value={choice.attackRegion}
              onChange={(attackRegion) => setChoice((current) => ({ ...current, attackRegion }))}
              options={[
                { value: "upper", label: "⬆️ Parte superior" },
                { value: "lower", label: "⬇️ Parte inferior" }
              ]}
            />
            <ChoiceGroup
              title="Onde vai defender?"
              value={choice.defendRegion}
              onChange={(defendRegion) => setChoice((current) => ({ ...current, defendRegion }))}
              options={[
                { value: "upper", label: "🛡️ Parte superior" },
                { value: "lower", label: "🛡️ Parte inferior" }
              ]}
            />
          </div>
          <div className="sp-action-group">
            <span>O que vai fazer?</span>
            <div className="sp-choice-options">
              {[
                ["attack", "⚔️ Ataque"],
                ["ability", `✨ ${abilities[active.ability]?.name || "Habilidade"}`],
                ["switch", "🔄 Trocar criatura"]
              ].map(([actionType, label]) => (
                <button
                  type="button"
                  key={actionType}
                  className={choice.actionType === actionType ? "secondary selected" : "secondary"}
                  aria-pressed={choice.actionType === actionType}
                  disabled={actionType === "switch" && switchTargets.length === 0}
                  onClick={() => setChoice((current) => ({ ...current, actionType, targetIndex: null }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {choice.actionType === "switch" && (
            <div className="sp-switch-targets" aria-label="Escolha a criatura para trocar">
              {switchTargets.map(({ creature, index }) => (
                <button
                  type="button"
                  key={creature.id}
                  className={choice.targetIndex === index ? "secondary selected" : "secondary"}
                  aria-pressed={choice.targetIndex === index}
                  onClick={() => setChoice((current) => ({ ...current, targetIndex: index }))}
                >
                  <CreatureArt speciesId={creature.speciesId} stage={creature.stage} emoji={creatureById(creature.speciesId)?.emoji}/> {creature.name} · HP {creature.hp}/{creature.maxHp}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="primary sp-confirm" disabled={!canSubmit} onClick={confirmRound}>
            Confirmar escolhas
          </button>
        </div>
      ) : (
        <div className="sp-result">
          <h2>{resultText}</h2>
          <p>{battle.log[battle.log.length - 1]}</p>
        </div>
      )}

      <div className="battle-log" aria-live="polite">
        {battle.log.slice(-10).map((entry, index) => <p key={`${battle.turnNumber}-${index}`}>{entry}</p>)}
      </div>
      <button type="button" className="secondary" onClick={onBack}>Voltar</button>
    </div>
  );
}
