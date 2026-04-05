const summaryGrid = document.querySelector("#summary-grid");
const metaLine = document.querySelector("#meta-line");
const caveats = document.querySelector("#caveats");
const playerList = document.querySelector("#player-list");
const eventList = document.querySelector("#event-list");
const networkPanel = document.querySelector("#network-panel");
const commandStatus = document.querySelector("#command-status");
const liveStatus = document.querySelector("#live-status");
const commandForm = document.querySelector("#command-form");
const commandInput = document.querySelector("#command-input");
const markExternalButton = document.querySelector("#mark-external-button");
const playerCardTemplate = document.querySelector("#player-card-template");

const DEFAULT_CAVEATS = [
  "この UI は Content Log に出た SpamTrace 情報だけを使います。",
  "ローカルワールドでは、参加者の本当の IP や Microsoft リレーの内側までは確定できません。",
  "ここで見える通信先はホスト PC 視点の観測であり、犯人の真の送信元を保証しません。"
];

const STATE_POLL_MS = 2500;
const NETWORK_POLL_MS = 8000;

let statePollTimer = null;
let networkPollTimer = null;
let lastEventSignature = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function quoteArg(value) {
  return `"${String(value ?? "").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function formatIso(isoText) {
  if (!isoText) {
    return "不明";
  }

  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) {
    return isoText;
  }

  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatLocation(player) {
  if (!player.lastLocation) {
    return player.lastDimension || "不明";
  }

  const { x, y, z } = player.lastLocation;
  const coords = [x, y, z].map((value) => (typeof value === "number" ? value.toFixed(0) : "?")).join(", ");
  return player.lastDimension ? `${player.lastDimension} / ${coords}` : coords;
}

function setStatus(text, tone = "idle") {
  commandStatus.textContent = text;
  commandStatus.dataset.tone = tone;
}

function setLiveStatus(text, tone = "idle") {
  liveStatus.textContent = text;
  liveStatus.dataset.tone = tone;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function sendCommand(command) {
  setStatus("送信中...", "busy");

  try {
    const result = await fetchJson("/api/command", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ command })
    });

    if (!result.ok) {
      throw new Error(result.message || "コマンド送信に失敗しました");
    }

    setStatus(`送信済み: ${command}`, "ok");
  } catch (error) {
    setStatus(`失敗: ${error.message}`, "error");
  }
}

function summaryCard(label, value, note) {
  return `
    <article class="summary-card">
      <p class="summary-label">${escapeHtml(label)}</p>
      <p class="summary-value">${escapeHtml(value)}</p>
      <p class="summary-note">${escapeHtml(note)}</p>
    </article>
  `;
}

function renderSummary(state) {
  summaryGrid.innerHTML = [
    summaryCard("現在参加中", state.summary.onlinePlayers ?? 0, "いまワールド内にいる人数"),
    summaryCard("累計イベント", state.summary.events ?? 0, "Content Log から読めた総イベント数"),
    summaryCard("怪しいイベント", state.summary.suspiciousEvents ?? 0, "スパム、異常名、ブロック一致など"),
    summaryCard("ブロック登録", state.summary.blocklistEntries ?? 0, "現在のブロック件数")
  ].join("");

  metaLine.textContent = `最終更新 ${formatIso(state.generatedAt)}`;
  caveats.innerHTML = DEFAULT_CAVEATS.map((item) => `<p class="caveat-item">${escapeHtml(item)}</p>`).join("");
}

function createTag(label, tone = "neutral") {
  const span = document.createElement("span");
  span.className = "pill";
  span.dataset.tone = tone;
  span.textContent = label;
  return span;
}

function pickName(player) {
  return player.name || player.nameTag || "(unknown)";
}

function buildKickCommand(player) {
  return `!st kick ${quoteArg(pickName(player))}`;
}

function buildQuarantineCommand(player, reason) {
  if (player.id) {
    return `!st quarantineid ${quoteArg(player.id)} ${quoteArg(reason)}`;
  }
  return `!st quarantine ${quoteArg(pickName(player))} ${quoteArg(reason)}`;
}

function buildTrustIdCommand(player, reason) {
  return `!st trustid ${quoteArg(player.id)} ${quoteArg(reason)}`;
}

function buildTrustNameCommand(player, reason) {
  return `!st trust name ${quoteArg(pickName(player))} ${quoteArg(reason)}`;
}

function buildBlockIdCommand(player, reason) {
  if (player.id) {
    return `!st blockid ${quoteArg(player.id)} ${quoteArg(reason)}`;
  }
  return `!st block name ${quoteArg(pickName(player))} ${quoteArg(reason)}`;
}

function buildUnblockCommand(player) {
  const value = player.id || pickName(player);
  return `!st unblock ${quoteArg(value)}`;
}

function playerTone(player) {
  if (player.blocklisted) {
    return "danger";
  }
  if ((player.score || 0) >= 8) {
    return "warn";
  }
  return "neutral";
}

function buildPlayerTags(player) {
  const tags = [];

  if (player.trusted) {
    tags.push({ label: "信頼済み", tone: "ok" });
  }
  if (player.blocklisted) {
    tags.push({ label: "ブロック済み", tone: "danger" });
  }

  for (const label of (player.messageReasons || []).map((item) => `msg:${item}`)) {
    tags.push({ label, tone: "warn" });
  }

  for (const label of (player.reasons || []).map((item) => `player:${item}`)) {
    tags.push({ label, tone: "neutral" });
  }

  return tags.slice(0, 8);
}

function renderPlayers(players) {
  playerList.innerHTML = "";

  if (!players.length) {
    playerList.innerHTML = '<p class="empty-state">現在参加中のプレイヤーはいません。</p>';
    return;
  }

  for (const player of players) {
    const fragment = playerCardTemplate.content.cloneNode(true);
    const root = fragment.querySelector(".player-card");

    fragment.querySelector(".player-name").textContent = pickName(player);
    fragment.querySelector(".player-subline").textContent = `最終観測 ${formatIso(player.lastSeenAt)}`;
    fragment.querySelector(".score-pill").textContent = `score ${player.score ?? 0}`;
    fragment.querySelector(".player-id").textContent = player.id || "なし";
    fragment.querySelector(".player-nametag").textContent = player.nameTag || "なし";
    fragment.querySelector(".player-location").textContent = formatLocation(player);
    fragment.querySelector(".player-stats").textContent =
      `join ${player.joinCount ?? 0} / leave ${player.leaveCount ?? 0} / spawn ${player.spawnCount ?? 0} / suspicious ${player.suspiciousCount ?? 0}`;
    fragment.querySelector(".player-message").textContent = player.lastMessage ? `最後の怪しい発言: ${player.lastMessage}` : "";

    const tagRow = fragment.querySelector(".tag-row");
    for (const tag of buildPlayerTags(player)) {
      tagRow.append(createTag(tag.label, tag.tone));
    }

    fragment.querySelector(".kick-button").addEventListener("click", () => sendCommand(buildKickCommand(player)));
    fragment.querySelector(".quarantine-button").addEventListener("click", () => {
      const reason = window.prompt("隔離理由", "UI quarantine");
      if (reason === null) {
        return;
      }
      sendCommand(buildQuarantineCommand(player, reason || "UI quarantine"));
    });

    const trustIdButton = fragment.querySelector(".trust-id-button");
    if (player.id) {
      trustIdButton.addEventListener("click", () => {
        const reason = window.prompt("信頼理由", "friend");
        if (reason === null) {
          return;
        }
        sendCommand(buildTrustIdCommand(player, reason || "friend"));
      });
    } else {
      trustIdButton.disabled = true;
    }

    fragment.querySelector(".trust-name-button").addEventListener("click", () => {
      const reason = window.prompt("信頼理由", "friend");
      if (reason === null) {
        return;
      }
      sendCommand(buildTrustNameCommand(player, reason || "friend"));
    });

    fragment.querySelector(".block-id-button").addEventListener("click", () => {
      const reason = window.prompt("ブロック理由", "UI block");
      if (reason === null) {
        return;
      }
      sendCommand(buildBlockIdCommand(player, reason || "UI block"));
    });

    fragment.querySelector(".unblock-button").addEventListener("click", () => sendCommand(buildUnblockCommand(player)));

    root.dataset.flagged = playerTone(player);
    playerList.append(fragment);
  }
}

function eventTitle(event) {
  const payload = event.payload || {};
  if (payload.player?.name) {
    return payload.player.name;
  }
  if (payload.playerName) {
    return payload.playerName;
  }
  if (payload.name) {
    return payload.name;
  }
  return "詳細なし";
}

function eventDetail(event) {
  const payload = event.payload || {};
  const parts = [];

  if (Array.isArray(payload.messageReasons) && payload.messageReasons.length) {
    parts.push(`msg=${payload.messageReasons.join(",")}`);
  }
  if (Array.isArray(payload.playerReasons) && payload.playerReasons.length) {
    parts.push(`player=${payload.playerReasons.join(",")}`);
  }
  if (Array.isArray(payload.reasons) && payload.reasons.length) {
    parts.push(`reasons=${payload.reasons.join(",")}`);
  }
  if (typeof payload.message === "string") {
    parts.push(payload.message);
  }
  if (payload.entry?.reason) {
    parts.push(`reason=${payload.entry.reason}`);
  }

  if (!parts.length) {
    parts.push(JSON.stringify(payload).slice(0, 180));
  }

  return parts.join(" / ");
}

function renderEvents(events) {
  const nextSignature = (events || []).map((event) => event.eventId).join("|");
  if (nextSignature === lastEventSignature) {
    return;
  }

  lastEventSignature = nextSignature;
  eventList.innerHTML = "";

  if (!events.length) {
    eventList.innerHTML = '<p class="empty-state">イベントはまだありません。</p>';
    return;
  }

  eventList.innerHTML = events
    .map(
      (event) => `
      <article class="event-item">
        <div class="event-head">
          <span class="event-label">${escapeHtml(event.label)}</span>
          <span class="muted">${escapeHtml(formatIso(event.occurredAt))}</span>
        </div>
        <p class="event-title">${escapeHtml(eventTitle(event))}</p>
        <p class="muted">${escapeHtml(eventDetail(event))}</p>
        <p class="tiny">${escapeHtml(`${event.sourceFile}:${event.lineNumber}`)}</p>
      </article>
    `
    )
    .join("");
}

function renderNetwork(snapshot) {
  if (!snapshot.ok) {
    networkPanel.innerHTML = `<p class="empty-state">${escapeHtml(snapshot.message || "通信観測を取得できませんでした")}</p>`;
    return;
  }

  if (!snapshot.running) {
    networkPanel.innerHTML = `
      <p class="empty-state">Minecraft は起動していません。</p>
      <p class="muted">${escapeHtml(snapshot.caveat || "")}</p>
    `;
    return;
  }

  const tcpRows = (snapshot.tcp || [])
    .slice(0, 12)
    .map((entry) => `<li>${escapeHtml(`${entry.LocalAddress}:${entry.LocalPort} -> ${entry.RemoteAddress}:${entry.RemotePort} (${entry.State})`)}</li>`)
    .join("");
  const udpRows = (snapshot.udp || [])
    .slice(0, 12)
    .map((entry) => `<li>${escapeHtml(`${entry.LocalAddress}:${entry.LocalPort}`)}</li>`)
    .join("");

  networkPanel.innerHTML = `
    <div class="network-summary">
      <p><strong>プロセス</strong> ${escapeHtml(snapshot.process?.name || "なし")}</p>
      <p><strong>PID</strong> ${escapeHtml(snapshot.process?.id || "なし")}</p>
    </div>
    <p class="muted">${escapeHtml(snapshot.caveat || "")}</p>
    <div class="network-columns">
      <div>
        <h3>TCP</h3>
        <ul>${tcpRows || "<li>なし</li>"}</ul>
      </div>
      <div>
        <h3>UDP</h3>
        <ul>${udpRows || "<li>なし</li>"}</ul>
      </div>
    </div>
  `;
}

async function refreshState({ silent = false } = {}) {
  const state = await fetchJson("/api/state");
  renderSummary(state);
  renderPlayers(state.onlinePlayers || []);
  renderEvents(state.events || []);

  if (silent) {
    setLiveStatus(`自動更新 ${formatIso(state.generatedAt)}`, "ok");
  }

  return state;
}

async function refreshNetwork() {
  const snapshot = await fetchJson("/api/network");
  renderNetwork(snapshot);
}

async function refreshAll({ silent = false } = {}) {
  try {
    await refreshState({ silent });
    await refreshNetwork();
    if (!silent) {
      setStatus("更新完了", "ok");
    }
  } catch (error) {
    setStatus(`更新失敗: ${error.message}`, "error");
    setLiveStatus("自動更新失敗", "error");
  }
}

function startPolling() {
  statePollTimer = window.setInterval(() => {
    if (!document.hidden) {
      refreshState({ silent: true }).catch(() => {});
    }
  }, STATE_POLL_MS);

  networkPollTimer = window.setInterval(() => {
    if (!document.hidden) {
      refreshNetwork().catch(() => {});
    }
  }, NETWORK_POLL_MS);
}

document.querySelector("#refresh-button").addEventListener("click", () => {
  refreshAll({ silent: false });
});

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => {
    sendCommand(button.dataset.command);
  });
});

markExternalButton.addEventListener("click", () => {
  const note = window.prompt("マーカー用メモ", "external spam visible now");
  if (note === null) {
    return;
  }
  sendCommand(`!st mark ${quoteArg(note || "external spam visible now")}`);
});

commandForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const command = commandInput.value.trim();
  if (!command) {
    return;
  }
  sendCommand(command);
  commandInput.select();
});

setStatus("待機中", "idle");
setLiveStatus(`自動更新 ${STATE_POLL_MS / 1000}秒`, "ok");
refreshAll({ silent: false });
startPolling();
