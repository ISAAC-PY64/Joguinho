import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDeviceId, getSessionToken } from "./systems/session.js";
import { migrateCreatureHealth } from "./systems/game.js";
import { saveGame } from "./storage/store.js";

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" })
    .format(new Date(timestamp));
}

export default function ProfileBackupManager({ game, setGame, setToast, visible }) {
  const playerId = game.profile.id;
  const deviceId = useMemo(() => getDeviceId(), []);
  const sessionToken = useMemo(() => getSessionToken(playerId), [playerId]);
  const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
  const latestGame = useRef(game);
  const backupInProgress = useRef(false);
  const [backupStatus, setBackupStatus] = useState({ kind: "waiting", message: "" });
  const [backups, setBackups] = useState([]);
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    latestGame.current = game;
  }, [game]);

  const sendRequest = useCallback(async (endpoint, extra = {}) => {
    const url = new URL(`/api/backups${endpoint}`, serverUrl).toString();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ deviceId, playerId, sessionToken, ...extra })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "O servidor recusou a solicitação de backup.");
    return result;
  }, [deviceId, playerId, sessionToken, serverUrl]);

  const saveBackup = useCallback(async () => {
    if (backupInProgress.current) return;
    backupInProgress.current = true;
    try {
      const result = await sendRequest("", { game: latestGame.current });
      setBackupStatus({ kind: "saved", createdAt: result.createdAt, message: "" });
    } catch (error) {
      const message = error instanceof TypeError
        ? "Não foi possível acessar o servidor. Confira o endereço e se ele está ligado."
        : error.message;
      setBackupStatus({ kind: "error", message });
    } finally {
      backupInProgress.current = false;
    }
  }, [sendRequest]);

  useEffect(() => {
    void saveBackup();
    const timer = setInterval(() => void saveBackup(), 30_000);
    return () => {
      clearInterval(timer);
    };
  }, [saveBackup]);

  const loadBackups = async () => {
    setLoadingBackups(true);
    try {
      const result = await sendRequest("/list");
      setBackups(result.backups);
      setSelectedBackupId(result.backups[0]?.id || "");
      if (result.backups.length === 0) setBackupStatus({ kind: "empty", message: "Nenhum backup disponível." });
    } catch (error) {
      setBackupStatus({ kind: "error", message: error.message });
    } finally {
      setLoadingBackups(false);
    }
  };

  const restoreBackup = async () => {
    const selected = backups.find((backup) => backup.id === selectedBackupId);
    if (!selected || !window.confirm("Restaurar este backup? O progresso atual deste navegador será substituído.")) return;
    setRestoring(true);
    try {
      const result = await sendRequest("/restore", { backupId: selected.id });
      if (result.game?.profile?.id !== playerId) throw new Error("O backup não pertence a este perfil.");
      const restoredGame = migrateCreatureHealth(result.game);
      await saveGame(restoredGame);
      setGame(restoredGame);
      setBackupStatus({ kind: "saved", createdAt: result.createdAt, message: "Backup restaurado." });
      setToast("Backup restaurado neste navegador.");
    } catch (error) {
      setBackupStatus({ kind: "error", message: error.message });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section className="panel backup-panel" hidden={!visible}>
      <h3>Backup do perfil</h3>
      <p className="muted">Este dispositivo envia seu perfil ao servidor configurado na aba Amigos a cada 30 segundos enquanto o jogo estiver aberto.</p>
      <p className={`backup-status ${backupStatus.kind}`}>
        {backupStatus.kind === "saved" && `● Backup salvo ${formatTime(backupStatus.createdAt)}${backupStatus.message ? ` · ${backupStatus.message}` : ""}`}
        {backupStatus.kind === "waiting" && "Verificando a configuração de backup…"}
        {backupStatus.kind === "error" && `Não foi possível fazer o backup: ${backupStatus.message}`}
        {backupStatus.kind === "empty" && backupStatus.message}
      </p>
      <div className="backup-actions">
        <button type="button" className="secondary" onClick={loadBackups} disabled={loadingBackups}>
          {loadingBackups ? "Buscando…" : "Buscar backups"}
        </button>
        {backups.length > 0 && (
          <>
            <select aria-label="Versão do backup" value={selectedBackupId} onChange={(event) => setSelectedBackupId(event.target.value)}>
              {backups.map((backup, index) => (
                <option key={backup.id} value={backup.id}>
                  {index === 0 ? "Mais recente" : "Arquivo diário"} · {formatTime(backup.createdAt)}
                </option>
              ))}
            </select>
            <button type="button" className="primary" onClick={restoreBackup} disabled={restoring}>
              {restoring ? "Restaurando…" : "Restaurar selecionado"}
            </button>
          </>
        )}
      </div>
      <small className="muted">O servidor guarda o backup mais recente e até 30 arquivos diários. Se o jogo estiver fechado, nenhum backup novo é enviado.</small>
    </section>
  );
}
