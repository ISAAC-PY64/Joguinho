import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { creatureById, rarityLabels, abilities } from "./data/creatures.js";
import CreatureArt from "./CreatureArt.jsx";
import { getSessionToken } from "./systems/session.js";
import "./styles/multiplayer.css";

const emptyChoice = () => ({ actionType: "attack", attackRegion: "upper", defendRegion: "upper", targetIndex: null });

function CreatureDetails({ creature, active = false, onSelect, selected = false, disabled = false }) {
  const species = creatureById(creature.speciesId);
  return (
    <button
      type="button"
      className={`mp-creature${active ? " active" : ""}${selected ? " selected" : ""}`}
      onClick={onSelect}
      disabled={disabled}
    >
      <span className="mp-creature-art"><CreatureArt speciesId={creature.speciesId} stage={creature.stage} emoji={species?.emoji}/></span>
      <span className="mp-creature-info">
        <b>{creature.name}</b>
        <small>{rarityLabels[creature.rarity] || creature.rarity} · {species?.element || "—"}</small>
        <small>HP {creature.hp ?? creature.stats.hp}/{creature.maxHp || creature.stats.hp} · ATK {creature.stats.attack} · DEF {creature.stats.defense} · SPD {creature.stats.speed}</small>
        {creature.ability && <small>✨ {abilities[creature.ability]?.name || creature.ability}</small>}
        {creature.effects?.shield && <small className="mp-effect">🛡️ Escudo ativo</small>}
        {creature.effects?.poisonTurns > 0 && <small className="mp-effect">☠️ Veneno · {creature.effects.poisonTurns}</small>}
        {creature.effects?.evasion && <small className="mp-effect">💨 Pronta para esquivar</small>}
      </span>
    </button>
  );
}

export default function Multiplayer({ game, onResult, setToast, visible }) {
  const playerId = game.profile.id;
  const sessionToken = useMemo(() => getSessionToken(playerId), [playerId]);
  const savedRoomKey = `monster-haven-room-${playerId}`;
  const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
  const autoConnectAttempted = useRef(false);
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [room, setRoom] = useState(null);
  const [battle, setBattle] = useState(null);
  const [battleChoice, setBattleChoice] = useState(emptyChoice);
  const [submitted, setSubmitted] = useState(false);
  const lastBattleRound = useRef(null);
  const [roomCode, setRoomCode] = useState(() => localStorage.getItem(savedRoomKey) || "");
  const [selection, setSelection] = useState([]);
  const [busy, setBusy] = useState(false);
  const players = room?.players || [];
  const me = players.find((player) => player.playerId === playerId);
  const rival = players.find((player) => player.playerId !== playerId);
  const battleMe = battle?.players.find((player) => player.playerId === playerId);
  const battleRival = battle?.players.find((player) => player.playerId !== playerId);

  useEffect(() => {
    if (!battle?.finished || !battle.winnerId) return;
    const resultKey = `monster-haven-result-${roomCode}-${playerId}`;
    if (localStorage.getItem(resultKey)) return;
    localStorage.setItem(resultKey, "1");
    onResult(battle.winnerId === playerId);
  }, [battle, onResult, playerId, roomCode]);

  useEffect(() => () => socket?.disconnect(), [socket]);

  const connect = () => {
    if (socket) socket.disconnect();
    let parsedAddress;
    try {
      parsedAddress = new URL(serverUrl);
      if (!["http:", "https:"].includes(parsedAddress.protocol) || parsedAddress.pathname !== "/" ||
        parsedAddress.search || parsedAddress.hash) throw new Error("URL inválida.");
    } catch {
      const message = "URL do servidor inválida. Configure VITE_SERVER_URL antes de gerar a versão do jogo.";
      setConnectionError(message);
      setToast(message);
      return;
    }
    if (window.location.protocol === "https:" && parsedAddress.protocol !== "https:") {
      const message = "O servidor precisa usar HTTPS/WSS quando o jogo está publicado com HTTPS.";
      setConnectionError(message);
      setToast(message);
      return;
    }
    setConnectionError("");
    const next = io(parsedAddress.origin, { timeout: 5000, autoConnect: false });
    next.on("connect", () => {
      setConnected(true);
      setConnectionError("");
      setToast("Conectado ao servidor!");
      const savedCode = localStorage.getItem(savedRoomKey);
      if (savedCode) {
        next.emit("room:resume", { code: savedCode, playerId, sessionToken }, (response) => {
          if (response?.error) {
            localStorage.removeItem(savedRoomKey);
            setToast(response.error);
            return;
          }
          setRoomCode(savedCode);
          setRoom(response.room);
          setBattle(response.battle);
          setSubmitted(response.submitted);
          lastBattleRound.current = response.battle?.turnNumber ?? null;
          setToast("Partida restaurada.");
        });
      }
    });
    next.on("connect_error", (error) => {
      setConnected(false);
      const message = `Falha ao conectar (${error.message}). Confira VITE_SERVER_URL e se o servidor online está ativo.`;
      setConnectionError(message);
      setToast("Falha na conexão. Veja as instruções na aba Amigos.");
    });
    next.on("disconnect", () => setConnected(false));
    next.on("room:update", (data) => setRoom(data));
    next.on("battle:update", (data) => {
      if (lastBattleRound.current !== data.turnNumber) {
        setSubmitted(false);
        setBattleChoice(emptyChoice());
        lastBattleRound.current = data.turnNumber;
      }
      setBattle(data);
    });
    next.on("room:error", (data) => data?.error && setToast(data.error));
    setSocket(next);
    next.connect();
  };

  useEffect(() => {
    if (!roomCode || autoConnectAttempted.current) return;
    autoConnectAttempted.current = true;
    connect();
  }, []);

  const createRoom = () => {
    if (!socket?.connected) return setToast("Conecte-se ao servidor primeiro.");
    socket.emit("room:create", { name: game.profile.name, playerId, sessionToken }, (response) => {
      if (response?.error) return setToast(response.error);
      localStorage.setItem(savedRoomKey, response.code);
      setRoomCode(response.code);
      setRoom(response.room);
      setBattle(null);
      setToast(`Sala ${response.code} criada. Compartilhe o código com seu amigo.`);
    });
  };

  const joinRoom = () => {
    if (!socket?.connected) return setToast("Conecte-se ao servidor primeiro.");
    socket.emit("room:join", { code: roomCode.trim().toUpperCase(), name: game.profile.name, playerId, sessionToken }, (response) => {
      if (response?.error) return setToast(response.error);
      localStorage.setItem(savedRoomKey, response.room.code);
      setRoomCode(response.room.code);
      setRoom(response.room);
      setBattle(null);
      setToast("Você entrou na sala.");
    });
  };

  const toggleCreature = (id) => {
    setSelection((selected) => selected.includes(id)
      ? selected.filter((item) => item !== id)
      : selected.length < 3 ? [...selected, id] : selected);
  };

  const confirmTeam = () => {
    if (!socket?.connected || selection.length !== 3) return;
    setBusy(true);
    const roster = game.creatures.map(({ id, speciesId, stage, stats }) => ({ id, speciesId, stage, stats }));
    const selected = game.creatures
      .filter((creature) => selection.includes(creature.id))
      .map(({ id, speciesId, stage }) => ({ id, speciesId, stage }));
    socket.emit("team:submit", { roster, selected }, (response) => {
      setBusy(false);
      if (response?.error) return setToast(response.error);
      setRoom(response.room);
      if (response.started) setToast("As duas equipes estão prontas. A batalha começou!");
    });
  };

  const sendChoice = () => {
    if (!socket?.connected) return setToast("Conexão perdida. A partida será pausada até a reconexão.");
    socket.emit("battle:choice", { choice: battleChoice }, (response) => {
      if (response?.error) setToast(response.error);
      else if (response?.ok) {
        setSubmitted(!response.resolved);
        if (response.resolved) setBattleChoice(emptyChoice());
      }
    });
  };

  const leaveRoom = () => {
    if (!socket?.connected) return setToast("Conecte-se novamente para sair da sala.");
    socket.emit("room:leave", (response) => {
      if (response?.error) return setToast(response.error);
      localStorage.removeItem(savedRoomKey);
      setRoom(null);
      setBattle(null);
      setRoomCode("");
      setSelection([]);
    });
  };

  const readyToChoose = room?.status === "waiting" && players.length === 2 && players.every((player) => player.connected);
  const canChoose = Boolean(battle && !battle.finished && !battle.paused && !submitted);

  return (
    <section className="panel multiplayer-panel" hidden={!visible}>
      <div className="panel-intro">
        <span className="big-icon">🤝</span>
        <div>
          <h2>Batalha multiplayer</h2>
          <p>Crie uma sala privada ou entre com o código de convite. As batalhas não alteram sua coleção nem seus recursos.</p>
        </div>
      </div>
      <label>Servidor multiplayer configurado</label>
      <div className="inline-form">
        <input value={serverUrl} readOnly aria-label="URL do servidor multiplayer" />
        <button className="primary" onClick={connect} disabled={connected}>{connected ? "Conectado" : "Conectar"}</button>
      </div>
      <small className="muted tiny">Definido por VITE_SERVER_URL na publicação; em desenvolvimento, usa localhost.</small>
      <p className={connected ? "connection-state" : connectionError ? "connection-error" : "muted tiny"}>
        {connected ? "● Conectado ao servidor" : connectionError || "○ Desconectado"}
      </p>

      {!room && (
        <>
          <hr />
          <label>Criar uma sala privada</label>
          <button className="primary" onClick={createRoom} disabled={!connected}>Criar sala</button>
          <label className="mt">Entrar com código de convite</label>
          <div className="inline-form">
            <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="Ex.: A7K2Q" maxLength={6} />
            <button className="secondary" onClick={joinRoom} disabled={!connected || roomCode.trim().length !== 6}>Entrar</button>
          </div>
        </>
      )}

      {room && !battle && (
        <div className="mp-lobby">
          <div className="room-card">
            <b>Sala {room.code}</b>
            <p>{room.status === "closed" ? "Sala encerrada" : "Jogadores conectados: "}{room.status !== "closed" && `${players.filter((player) => player.connected).length}/2`}</p>
            {players.map((player) => (
              <small key={player.playerId}>
                {player.connected ? "●" : "○"} {player.name}{player.playerId === playerId ? " (você)" : ""}
                {player.ready ? " · equipe confirmada" : ""}
              </small>
            ))}
            {players.length === 1 && <p className="muted tiny">Aguardando seu amigo. Código: <strong>{room.code}</strong></p>}
            <button type="button" className="secondary block" onClick={leaveRoom}>Sair da sala</button>
          </div>
          {readyToChoose && !me?.ready && (
            <div className="mp-team-picker">
              <h3>Escolha três criaturas</h3>
              <p className="muted tiny">Selecione {selection.length}/3 criaturas da sua coleção e confirme sua equipe.</p>
              {game.creatures.length < 3 ? <p className="muted">Você precisa ter ao menos três criaturas na coleção.</p> : (
                <>
                  <div className="mp-team-grid">
                    {game.creatures.map((creature) => (
                      <CreatureDetails
                        key={creature.id}
                        creature={creature}
                        selected={selection.includes(creature.id)}
                        onSelect={() => toggleCreature(creature.id)}
                        disabled={busy}
                      />
                    ))}
                  </div>
                  <button className="primary wide" onClick={confirmTeam} disabled={selection.length !== 3 || busy}>
                    {busy ? "Confirmando…" : "Confirmar equipe"}
                  </button>
                </>
              )}
            </div>
          )}
          {me?.ready && <p className="connection-state">Equipe confirmada. Aguardando a escolha do adversário…</p>}
          {rival && !rival.connected && <p className="muted tiny">Adversário desconectado. A sala ficará disponível por 60 segundos para reconexão.</p>}
        </div>
      )}

      {battle && battleMe && battleRival && (
        <div className="mp-battle">
          <div className="mp-battle-heading">
            <span className="eyebrow">ARENA MULTIPLAYER</span>
            <b>{battle.finished ? "PARTIDA ENCERRADA" : battle.paused ? "AGUARDANDO RECONEXÃO" : "ESCOLHAS SIMULTÂNEAS"}</b>
            <small>Rodada {battle.turnNumber}</small>
          </div>
          {battle.paused && <p className="mp-paused">Partida pausada. O jogador desconectado tem 60 segundos para retornar.</p>}
          {battle.finished && <div className={`mp-result ${battle.draw ? "draw" : battle.winnerId === playerId ? "won" : "lost"}`}>{battle.draw ? "🤝 Empate" : battle.winnerId === playerId ? "🏆 Vitória!" : "💫 Derrota"}<small>{battle.draw ? "As duas equipes foram derrotadas na mesma rodada." : battle.winnerId === playerId ? "Você derrotou a equipe adversária." : "Suas criaturas estão seguras e continuam na coleção."}</small></div>}
          <div className="mp-teams">
            {[battleRival, battleMe].map((player) => (
              <div className="mp-side" key={player.playerId}>
                <h3>{player.name}{player.playerId === playerId ? " (você)" : ""}</h3>
                {player.team.map((creature, index) => (
                  <CreatureDetails
                    key={creature.id}
                    creature={creature}
                    active={player.active === index}
                    selected={battleChoice.actionType === "switch" && battleChoice.targetIndex === index}
                    disabled={player.playerId !== playerId || !canChoose || battleChoice.actionType !== "switch" || player.active === index || creature.hp <= 0}
                    onSelect={player.playerId === playerId && canChoose && battleChoice.actionType === "switch"
                      ? () => setBattleChoice((current) => ({ ...current, targetIndex: index }))
                      : undefined}
                  />
                ))}
              </div>
            ))}
          </div>
          {canChoose && (
            <div className="mp-round-controls">
              <div className="mp-choice-group">
                <b>Onde vai golpear?</b>
                <div className="mp-choice-options">
                  {[["upper", "⬆️ Parte superior"], ["lower", "⬇️ Parte inferior"]].map(([region, label]) => (
                    <button key={region} className={battleChoice.attackRegion === region ? "secondary selected" : "secondary"}
                      onClick={() => setBattleChoice((current) => ({ ...current, attackRegion: region }))}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="mp-choice-group">
                <b>Onde vai defender?</b>
                <div className="mp-choice-options">
                  {[["upper", "🛡️ Parte superior"], ["lower", "🛡️ Parte inferior"]].map(([region, label]) => (
                    <button key={region} className={battleChoice.defendRegion === region ? "secondary selected" : "secondary"}
                      onClick={() => setBattleChoice((current) => ({ ...current, defendRegion: region }))}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="mp-choice-group">
                <b>O que vai fazer?</b>
                <div className="mp-choice-options">
                  <button className={battleChoice.actionType === "attack" ? "secondary selected" : "secondary"}
                    onClick={() => setBattleChoice((current) => ({ ...current, actionType: "attack", targetIndex: null }))}>⚔️ Ataque</button>
                  <button className={battleChoice.actionType === "ability" ? "secondary selected" : "secondary"}
                    onClick={() => setBattleChoice((current) => ({ ...current, actionType: "ability", targetIndex: null }))}>✨ Habilidade especial</button>
                  <button className={battleChoice.actionType === "switch" ? "secondary selected" : "secondary"}
                    onClick={() => setBattleChoice((current) => ({ ...current, actionType: "switch" }))}>🔄 Trocar criatura</button>
                </div>
                {battleChoice.actionType === "switch" && <small className="muted tiny">A troca substitui seu ataque nesta rodada. Escolha uma criatura viva da sua equipe.</small>}
              </div>
              <button className="primary wide" onClick={sendChoice} disabled={battleChoice.actionType === "switch" && battleChoice.targetIndex === null}>
                Confirmar escolhas
              </button>
              <p className="muted tiny mp-secret-note">Sua escolha fica oculta. O resultado aparece quando os dois jogadores confirmarem.</p>
            </div>
          )}
          {submitted && <p className="connection-state">Escolha registrada e oculta. Aguardando a seleção do adversário…</p>}
          <div className="battle-log" aria-live="polite">
            {battle.log.map((entry, index) => <p key={`${index}-${entry}`}>{entry}</p>)}
          </div>
          {battle.finished && <button className="secondary" onClick={leaveRoom}>Voltar para salas</button>}
        </div>
      )}
      <p className="muted tiny mp-note">Os atributos individuais são validados pelo servidor antes do combate. Como o progresso ainda é local, a propriedade original das criaturas não pode ser verificada sem contas e inventários armazenados no servidor.</p>
    </section>
  );
}
