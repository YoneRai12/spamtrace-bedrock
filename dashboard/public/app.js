const summaryGrid = document.querySelector("#summary-grid");
const metaLine = document.querySelector("#meta-line");
const caveats = document.querySelector("#caveats");
const playerList = document.querySelector("#player-list");
const eventList = document.querySelector("#event-list");
const networkPanel = document.querySelector("#network-panel");
const commandStatus = document.querySelector("#command-status");
const commandForm = document.querySelector("#command-form");
const commandInput = document.querySelector("#command-input");
const markExternalButton = document.querySelector("#mark-external-button");
const playerCardTemplate = document.querySelector("#player-card-template");

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

function setStatus(text, tone = "idle") {
  commandStatus.textContent = text;
  commandStatus.dataset.tone = tone;
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
    summaryCard("イベント数", state.summary.events, "Content Log から読み取った累計イベント"),
    summaryCard("怪しいイベント", state.summary.suspiciousEvents, "スパム、異常名、ブロック一致など"),
    summaryCard("追跡プレイヤー", state.summary.trackedPlayers, "ログに現れたユニーク参加者"),
    summaryCard("ブロック登録", state.summary.blocklistEntries, "現在のブロック件数")
  ].join("");

  metaLine.textContent = `最終更新: ${state.generatedAt} / ログ: ${state.logDir ?? "未検出"}`;
  caveats.innerHTML = (state.caveats || []).map((item) => `<p class="caveat-item">${escapeHtml(item)}</p>`).join("");
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
  if (player.score >= 8) {
    return "warn";
  }
  return "neutral";
}

function renderPlayers(players) {
  playerList.innerHTML = "";

  if (!players.length) {
    playerList.innerHTML = '<p class="muted">まだ SpamTrace イベントがありません。</p>';
    return;
  }

  for (const player of players) {
    const fragment = playerCardTemplate.content.cloneNode(true);
    const root = fragment.querySelector(".player-card");
    const name = pickName(player);

    fragment.querySelector(".player-name").textContent = name;
    fragment.querySelector(".score-pill").textContent = `score ${player.score}`;
    fragment.querySelector(".player-meta").textContent =
      `id=${player.id || "なし"} / nameTag=${player.nameTag || "なし"} / 最終=${player.lastSeenAt || "なし"}`;
    fragment.querySelector(".player-stats").textContent =
      `join ${player.joinCount} / leave ${player.leaveCount} / spawn ${player.spawnCount} / suspicious ${player.suspiciousCount} / anomaly ${player.anomalyCount} / blockHit ${player.blockHitCount}`;
    fragment.querySelector(".player-message").textContent = player.lastMessage ? `最後の怪しい発言: ${player.lastMessage}` : "";

    const tagRow = fragment.querySelector(".tag-row");
    const tags = []
      .concat(player.indicatorTags || [])
      .concat((player.messageReasons || []).map((item) => `msg:${item}`))
      .concat((player.reasons || []).map((item) => `player:${item}`));

    for (const item of tags.slice(0, 8)) {
      const tone = item.includes("ブロック") ? "danger" : item.includes("疑い") ? "warn" : "neutral";
      tagRow.append(createTag(item, tone));
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
  eventList.innerHTML = "";

  if (!events.length) {
    eventList.innerHTML = '<p class="muted">イベントはまだありません。</p>';
    return;
  }

  eventList.innerHTML = events
    .map(
      (event) => `
      <article class="event-item">
        <div class="event-head">
          <span class="event-label">${escapeHtml(event.label)}</span>
          <span class="muted">${escapeHtml(event.occurredAt)}</span>
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
    networkPanel.innerHTML = `<p class="muted">${escapeHtml(snapshot.message || "通信観測を取得できませんでした")}</p>`;
    return;
  }

  if (!snapshot.running) {
    networkPanel.innerHTML = `
      <p class="muted">Minecraft は起動していません。</p>
      <p class="muted">${escapeHtml(snapshot.caveat || "")}</p>
    `;
    return;
  }

  const tcpRows = (snapshot.tcp || [])
    .slice(0, 10)
    .map((entry) => `<li>${escapeHtml(`${entry.LocalAddress}:${entry.LocalPort} -> ${entry.RemoteAddress}:${entry.RemotePort} (${entry.State})`)}</li>`)
    .join("");
  const udpRows = (snapshot.udp || [])
    .slice(0, 10)
    .map((entry) => `<li>${escapeHtml(`${entry.LocalAddress}:${entry.LocalPort}`)}</li>`)
    .join("");

  networkPanel.innerHTML = `
    <p><strong>プロセス:</strong> ${escapeHtml(snapshot.process?.name || "なし")} / pid=${escapeHtml(snapshot.process?.id || "なし")}</p>
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

async function refreshState() {
  const state = await fetchJson("/api/state");
  renderSummary(state);
  renderPlayers(state.players || []);
  renderEvents(state.events || []);
}

async function refreshNetwork() {
  const snapshot = await fetchJson("/api/network");
  renderNetwork(snapshot);
}

async function refreshAll() {
  try {
    await refreshState();
    await refreshNetwork();
    setStatus("更新完了", "ok");
  } catch (error) {
    setStatus(`更新失敗: ${error.message}`, "error");
  }
}

document.querySelector("#refresh-button").addEventListener("click", refreshAll);

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

refreshAll();
