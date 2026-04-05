import { system, world } from "@minecraft/server";

const TRACE_PREFIX = "[SpamTrace]";
const TRACE_VERSION = "1.5.0";
const ADMIN_TAG = "spam_trace_admin";
const ADMIN_OWNER_KEY = "codex:spamtrace:adminOwner";
const BLOCKLIST_KEY = "codex:spamtrace:blocklist";
const TRUSTLIST_KEY = "codex:spamtrace:trustlist";
const SETTINGS_KEY = "codex:spamtrace:settings";
const LIST_LIMIT = 128;
const WATCHED_SCORES = ["Wb_Game", "Wb_Players", "Wb_life", "Wb_live", "Wb_watcher"];
const SPAM_PATTERNS = [
  { id: "lumineproxy", regex: /lumineproxy/i },
  { id: "discord_invite", regex: /discord\.gg\//i },
  { id: "auto_walk", regex: /auto walk/i },
  { id: "ghost_mode", regex: /ghost mode/i },
  { id: "reach", regex: /\breach\b/i },
  { id: "xray", regex: /\bxray\b/i },
  { id: "nuker", regex: /\bnuker\b/i },
  { id: "external_label", regex: /(external|\u5916\u90e8)/i }
];
const DEFAULT_SETTINGS = {
  lockdown: false,
  autoBlockSuspicious: false,
  chatGate: false,
  evidenceMode: false
};
const anomalyCache = new Map();

function safeCall(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function isoNow() {
  return safeCall(() => new Date().toISOString(), "unknown-time");
}

function truncate(value, maxLength = 220) {
  const text = typeof value === "string" ? value : String(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function jsonLine(payload) {
  return safeCall(() => JSON.stringify(payload), "{\"trace\":\"json_error\"}");
}

function getPlayers() {
  return safeCall(() => world.getPlayers(), []);
}

function safeDimensionId(player) {
  return safeCall(() => player.dimension.id, null);
}

function roundNumber(value) {
  return Math.round(value * 100) / 100;
}

function sendPrivate(player, text) {
  safeCall(() => player.sendMessage(`\u00a76${TRACE_PREFIX}\u00a7r ${truncate(text, 240)}`));
}

function sendLines(player, lines) {
  for (const line of lines) {
    sendPrivate(player, line);
  }
}

function notifyAdmins(text) {
  const admins = getPlayers().filter((player) => isAdminPlayer(player));
  for (const admin of admins) {
    sendPrivate(admin, text);
  }
}

function emit(label, payload, options = {}) {
  const line = `${TRACE_PREFIX} ${isoNow()} ${label} ${jsonLine(payload)}`;
  safeCall(() => console.warn(line));

  if (options.notify) {
    const detail = options.detail ? ` ${options.detail}` : "";
    notifyAdmins(`${label}${detail}`);
  }
}

function getScoreSnapshot(player) {
  const snapshot = {};
  for (const objectiveName of WATCHED_SCORES) {
    const score = safeCall(() => {
      const objective = world.scoreboard.getObjective(objectiveName);
      if (!objective || !player.scoreboardIdentity) {
        return null;
      }
      return objective.getScore(player.scoreboardIdentity);
    }, null);

    if (score !== null && score !== undefined) {
      snapshot[objectiveName] = score;
    }
  }
  return snapshot;
}

function snapshotPlayer(player) {
  return {
    id: safeCall(() => player.id, null),
    name: safeCall(() => player.name, ""),
    nameTag: safeCall(() => player.nameTag, ""),
    typeId: safeCall(() => player.typeId, null),
    dimension: safeDimensionId(player),
    location: safeCall(() => {
      const location = player.location;
      return {
        x: roundNumber(location.x),
        y: roundNumber(location.y),
        z: roundNumber(location.z)
      };
    }, null),
    tags: safeCall(() => player.getTags(), []),
    scoreboardIdentityId: safeCall(() => player.scoreboardIdentity?.id ?? null, null),
    scores: getScoreSnapshot(player)
  };
}

function rosterSummary() {
  return getPlayers().map((player) => {
    const snapshot = snapshotPlayer(player);
    return {
      id: snapshot.id,
      name: snapshot.name,
      nameTag: snapshot.nameTag,
      dimension: snapshot.dimension,
      location: snapshot.location
    };
  });
}

function detectPlayerAnomalies(snapshot) {
  const reasons = [];
  const name = snapshot.name || "";
  const nameTag = snapshot.nameTag || "";

  if (name.trim().length === 0) {
    reasons.push("blank_name");
  }
  if (nameTag.trim().length === 0) {
    reasons.push("blank_nameTag");
  }
  if (nameTag && nameTag !== name) {
    reasons.push("nameTag_mismatch");
  }
  if (name.length <= 1) {
    reasons.push("very_short_name");
  }
  if (/["']/.test(name)) {
    reasons.push("quoted_name");
  }
  if (/[\r\n]/.test(name) || /[\r\n]/.test(nameTag)) {
    reasons.push("multiline_name");
  }
  if (/[\x00-\x1F]/.test(name) || /[\x00-\x1F]/.test(nameTag)) {
    reasons.push("control_chars");
  }

  return reasons;
}

function detectMessageAnomalies(message) {
  const reasons = [];
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.regex.test(message)) {
      reasons.push(pattern.id);
    }
  }
  return reasons;
}

function findPlayerByJoinData(playerId, playerName) {
  const players = getPlayers();
  for (const player of players) {
    if (safeCall(() => player.id, null) === playerId) {
      return player;
    }
  }
  for (const player of players) {
    if (safeCall(() => player.name, "") === playerName) {
      return player;
    }
  }
  return null;
}

function parseArgs(text) {
  const args = [];
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(text))) {
    args.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return args;
}

function quoteCommandToken(value) {
  return JSON.stringify(String(value));
}

function runOverworldCommand(command) {
  return safeCall(() => world.getDimension("overworld").runCommand(command), null);
}

function normalizeListEntry(entry, fallbackSource = "unknown") {
  return {
    id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : null,
    name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : null,
    reason: typeof entry.reason === "string" ? truncate(entry.reason, 120) : "",
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : isoNow(),
    source: typeof entry.source === "string" ? entry.source : fallbackSource
  };
}

function loadListProperty(key) {
  const raw = safeCall(() => world.getDynamicProperty(key), "");
  if (typeof raw !== "string" || raw.length === 0) {
    return [];
  }

  const parsed = safeCall(() => JSON.parse(raw), []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map((entry) => normalizeListEntry(entry)).filter((entry) => entry.id || entry.name);
}

function saveListProperty(key, label, entries, source) {
  const normalized = entries
    .map((entry) => normalizeListEntry(entry, source))
    .filter((entry) => entry.id || entry.name)
    .slice(0, LIST_LIMIT);

  safeCall(() => world.setDynamicProperty(key, JSON.stringify(normalized)));
  emit(label, { source, entries: normalized }, { notify: true, detail: `entries=${normalized.length}` });
  return normalized;
}

function loadBlocklist() {
  return loadListProperty(BLOCKLIST_KEY);
}

function saveBlocklist(entries, source = "unknown") {
  return saveListProperty(BLOCKLIST_KEY, "blocklist_updated", entries, source);
}

function loadTrustlist() {
  return loadListProperty(TRUSTLIST_KEY);
}

function saveTrustlist(entries, source = "unknown") {
  return saveListProperty(TRUSTLIST_KEY, "trustlist_updated", entries, source);
}

function loadSettings() {
  const raw = safeCall(() => world.getDynamicProperty(SETTINGS_KEY), "");
  if (typeof raw !== "string" || raw.length === 0) {
    return { ...DEFAULT_SETTINGS };
  }

  const parsed = safeCall(() => JSON.parse(raw), {});
  return {
    lockdown: parsed.lockdown === true,
    autoBlockSuspicious: parsed.autoBlockSuspicious === true,
    chatGate: parsed.chatGate === true,
    evidenceMode: parsed.evidenceMode === true
  };
}

function saveSettings(nextSettings, source = "unknown") {
  const normalized = {
    lockdown: nextSettings.lockdown === true,
    autoBlockSuspicious: nextSettings.autoBlockSuspicious === true,
    chatGate: nextSettings.chatGate === true,
    evidenceMode: nextSettings.evidenceMode === true
  };

  safeCall(() => world.setDynamicProperty(SETTINGS_KEY, JSON.stringify(normalized)));
  emit("settings_updated", { source, settings: normalized }, { notify: true, detail: describeSettings(normalized) });
  return normalized;
}

function loadAdminOwner() {
  const raw = safeCall(() => world.getDynamicProperty(ADMIN_OWNER_KEY), "");
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }

  const parsed = safeCall(() => JSON.parse(raw), null);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const playerId = typeof parsed.playerId === "string" && parsed.playerId.trim() ? parsed.playerId.trim() : null;
  if (!playerId) {
    return null;
  }

  return {
    playerId,
    playerName: typeof parsed.playerName === "string" ? parsed.playerName : "",
    claimedAt: typeof parsed.claimedAt === "string" ? parsed.claimedAt : ""
  };
}

function saveAdminOwner(player, source = "unknown") {
  const snapshot = snapshotPlayer(player);
  if (!snapshot.id) {
    return null;
  }

  const owner = {
    playerId: snapshot.id,
    playerName: snapshot.name,
    claimedAt: isoNow()
  };

  safeCall(() => world.setDynamicProperty(ADMIN_OWNER_KEY, JSON.stringify(owner)));
  emit("admin_owner_updated", { source, owner, player: snapshot }, { notify: true, detail: `${snapshot.name} admin owner` });
  return owner;
}

function tryBootstrapAdminOwner(source = "unknown", preferredPlayer = null) {
  const currentOwner = loadAdminOwner();
  if (currentOwner) {
    return currentOwner;
  }

  if (preferredPlayer && safeCall(() => preferredPlayer.hasTag(ADMIN_TAG), false)) {
    return saveAdminOwner(preferredPlayer, source);
  }

  const players = getPlayers();
  if (players.length !== 1) {
    return null;
  }

  return saveAdminOwner(preferredPlayer ?? players[0], source);
}

function isAdminPlayer(player) {
  if (!player) {
    return false;
  }

  if (safeCall(() => player.hasTag(ADMIN_TAG), false)) {
    return true;
  }

  const owner = loadAdminOwner();
  if (!owner) {
    return false;
  }

  return safeCall(() => player.id, null) === owner.playerId;
}

function findMatchingEntry(snapshot, entries) {
  for (const entry of entries) {
    if (entry.id && snapshot.id && entry.id === snapshot.id) {
      return entry;
    }
    if (entry.name && snapshot.name && entry.name === snapshot.name) {
      return entry;
    }
  }
  return null;
}

function isSnapshotTrusted(snapshot, trustlist) {
  return findMatchingEntry(snapshot, trustlist) !== null;
}

function describeSettings(settings) {
  const tokens = [];
  tokens.push(`lockdown=${settings.lockdown ? "on" : "off"}`);
  tokens.push(`autoblock=${settings.autoBlockSuspicious ? "on" : "off"}`);
  tokens.push(`chatgate=${settings.chatGate ? "on" : "off"}`);
  tokens.push(`evidence=${settings.evidenceMode ? "on" : "off"}`);
  return tokens.join(" ");
}

function formatOnlinePlayers(emptyMessage = "オンラインのプレイヤーはいません") {
  const players = getPlayers();
  if (players.length === 0) {
    return [emptyMessage];
  }

  return players.slice(0, 8).map((player, index) => {
    const snapshot = snapshotPlayer(player);
    const roles = [];

    if (isAdminPlayer(player)) {
      roles.push("admin");
    }
    if (findMatchingEntry(snapshot, loadTrustlist())) {
      roles.push("trusted");
    }
    if (findMatchingEntry(snapshot, loadBlocklist())) {
      roles.push("blocked");
    }
    if (loadSettings().chatGate && isPendingApproval(snapshot)) {
      roles.push("pending");
    }

    const roleText = roles.length > 0 ? ` | ${roles.join(",")}` : "";
    return `${index + 1}. ${snapshot.name} | id=${snapshot.id ?? "unknown"}${roleText}`;
  });
}

function formatEntries(entries, emptyMessage) {
  if (entries.length === 0) {
    return [emptyMessage];
  }

  return entries.slice(0, 8).map((entry, index) => {
    const parts = [];
    if (entry.name) {
      parts.push(`name=${entry.name}`);
    }
    if (entry.id) {
      parts.push(`id=${entry.id}`);
    }
    if (entry.reason) {
      parts.push(`reason=${entry.reason}`);
    }
    return `${index + 1}. ${parts.join(" | ")}`;
  });
}

function kickPlayerBySnapshot(snapshot, reason = "Blocked by SpamTrace") {
  if (!snapshot.name) {
    return { ok: false, command: null, error: "missing_name" };
  }

  const selector = `@a[name=${quoteCommandToken(snapshot.name)}]`;
  const selectorCommand = `kick ${selector} ${reason}`;
  const selectorResult = runOverworldCommand(selectorCommand);
  if (selectorResult) {
    return {
      ok: true,
      mode: "selector",
      command: selectorCommand,
      statusMessage: safeCall(() => selectorResult.statusMessage, "")
    };
  }

  const literalCommand = `kick ${quoteCommandToken(snapshot.name)} ${reason}`;
  const literalResult = runOverworldCommand(literalCommand);
  if (literalResult) {
    return {
      ok: true,
      mode: "literal",
      command: literalCommand,
      statusMessage: safeCall(() => literalResult.statusMessage, "")
    };
  }

  return {
    ok: false,
    command: selectorCommand,
    fallbackCommand: literalCommand,
    error: "command_failed"
  };
}

function findOnlinePlayerById(playerId) {
  return getPlayers().find((player) => safeCall(() => player.id, null) === playerId) ?? null;
}

function findOnlinePlayerByName(name) {
  return getPlayers().find((player) => safeCall(() => player.name, "") === name) ?? null;
}

function addEntryToList(sender, currentEntries, payload, saveFn, duplicateMessage, successPrefix) {
  const exists = currentEntries.some((entry) => {
    return (payload.id && entry.id === payload.id) || (payload.name && entry.name === payload.name);
  });

  if (exists) {
    sendPrivate(sender, duplicateMessage);
    return currentEntries;
  }

  const nextEntries = currentEntries.concat([
    {
      id: payload.id ?? null,
      name: payload.name ?? null,
      reason: payload.reason ?? "",
      createdAt: isoNow(),
      source: payload.source ?? "manual"
    }
  ]);

  const saved = saveFn(nextEntries, payload.source ?? "manual");
  sendPrivate(sender, `${successPrefix}: ${payload.name ?? payload.id}`);
  return saved;
}

function removeEntryFromList(sender, currentEntries, value, saveFn, saveSource, emptyMessage, notFoundPrefix, successPrefix) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    sendPrivate(sender, emptyMessage);
    return currentEntries;
  }

  const nextEntries = currentEntries.filter((entry) => entry.id !== trimmed && entry.name !== trimmed);
  if (nextEntries.length === currentEntries.length) {
    sendPrivate(sender, `${notFoundPrefix}: ${trimmed}`);
    return currentEntries;
  }

  const saved = saveFn(nextEntries, saveSource);
  sendPrivate(sender, `${successPrefix}: ${trimmed}`);
  return saved;
}

function addBlockEntry(sender, payload) {
  return addEntryToList(
    sender,
    loadBlocklist(),
    payload,
    saveBlocklist,
    "\u3059\u3067\u306b\u30d6\u30ed\u30c3\u30af\u6e08\u307f\u3067\u3059",
    "\u30d6\u30ed\u30c3\u30af\u767b\u9332\u3057\u307e\u3057\u305f"
  );
}

function removeBlockEntry(sender, value) {
  return removeEntryFromList(
    sender,
    loadBlocklist(),
    value,
    saveBlocklist,
    "manual-unblock",
    "\u89e3\u9664\u5bfe\u8c61\u304c\u6307\u5b9a\u3055\u308c\u3066\u3044\u307e\u305b\u3093",
    "\u898b\u3064\u304b\u308a\u307e\u305b\u3093",
    "\u30d6\u30ed\u30c3\u30af\u89e3\u9664\u3057\u307e\u3057\u305f"
  );
}

function addTrustEntry(sender, payload) {
  return addEntryToList(
    sender,
    loadTrustlist(),
    payload,
    saveTrustlist,
    "\u3059\u3067\u306b\u4fe1\u983c\u6e08\u307f\u3067\u3059",
    "\u4fe1\u983c\u30ea\u30b9\u30c8\u306b\u8ffd\u52a0\u3057\u307e\u3057\u305f"
  );
}

function removeTrustEntry(sender, value) {
  return removeEntryFromList(
    sender,
    loadTrustlist(),
    value,
    saveTrustlist,
    "manual-untrust",
    "\u89e3\u9664\u5bfe\u8c61\u304c\u6307\u5b9a\u3055\u308c\u3066\u3044\u307e\u305b\u3093",
    "\u898b\u3064\u304b\u308a\u307e\u305b\u3093",
    "\u4fe1\u983c\u30ea\u30b9\u30c8\u304b\u3089\u5916\u3057\u307e\u3057\u305f"
  );
}

function enforcePolicy(player, context) {
  if (isAdminPlayer(player)) {
    return false;
  }

  const snapshot = snapshotPlayer(player);
  const blockEntry = findMatchingEntry(snapshot, loadBlocklist());
  if (blockEntry) {
    const outcome = kickPlayerBySnapshot(snapshot, "Blocked by SpamTrace");
    emit(
      "blocklist_match",
      { context, player: snapshot, entry: blockEntry, outcome },
      { notify: true, detail: `${snapshot.name} blocked` }
    );
    return true;
  }

  const settings = loadSettings();
  if (!settings.lockdown) {
    return false;
  }

  if (isSnapshotTrusted(snapshot, loadTrustlist())) {
    return false;
  }

  const outcome = kickPlayerBySnapshot(snapshot, "Lockdown by SpamTrace");
  emit(
    "lockdown_reject",
    {
      context,
      player: snapshot,
      settings,
      outcome
    },
    { notify: true, detail: `${snapshot.name} lockdown reject` }
  );
  return true;
}

function exportState(sender) {
  emit(
    "manual_export",
    {
      roster: rosterSummary(),
      blocklist: loadBlocklist(),
      trustlist: loadTrustlist(),
      settings: loadSettings()
    },
    { notify: true, detail: "manual export" }
  );
  sendPrivate(sender, "\u73fe\u5728\u306e\u72b6\u614b\u3092 Content Log \u306b\u66f8\u304d\u51fa\u3057\u307e\u3057\u305f");
}

function setBooleanSetting(sender, key, nextValue, source) {
  const saved = saveSettings({ ...loadSettings(), [key]: nextValue }, source);
  sendPrivate(sender, `\u8a2d\u5b9a\u66f4\u65b0: ${describeSettings(saved)}`);
  return saved;
}

function quarantineSnapshot(sender, snapshot, reason, source) {
  const blockReason = reason || "quarantine";
  addBlockEntry(sender, {
    id: snapshot.id ?? null,
    name: snapshot.name ?? null,
    reason: blockReason,
    source
  });

  const outcome = kickPlayerBySnapshot(snapshot, "Quarantine by SpamTrace");
  emit(
    "manual_quarantine",
    { source, player: snapshot, reason: blockReason, outcome },
    { notify: true, detail: `${snapshot.name} quarantine` }
  );
  sendPrivate(sender, outcome.ok ? `\u9694\u96e2\u3057\u307e\u3057\u305f: ${snapshot.name}` : `\u9694\u96e2\u5931\u6557: ${snapshot.name}`);
}

function emergencySweep(sender, reason) {
  const trustlist = loadTrustlist();
  const currentBlocklist = loadBlocklist();
  const targets = [];

  for (const player of getPlayers()) {
    if (isAdminPlayer(player)) {
      continue;
    }

    const snapshot = snapshotPlayer(player);
    if (isSnapshotTrusted(snapshot, trustlist)) {
      continue;
    }

    targets.push(snapshot);
  }

  if (targets.length === 0) {
    sendPrivate(sender, "\u9694\u96e2\u5bfe\u8c61\u306e\u30aa\u30f3\u30e9\u30a4\u30f3\u30d7\u30ec\u30a4\u30e4\u30fc\u306f\u3044\u307e\u305b\u3093");
    return;
  }

  const nextBlocklist = currentBlocklist.slice();
  for (const snapshot of targets) {
    if (!findMatchingEntry(snapshot, nextBlocklist)) {
      nextBlocklist.push({
        id: snapshot.id ?? null,
        name: snapshot.name ?? null,
        reason: reason || "emergency sweep",
        createdAt: isoNow(),
        source: "emergency"
      });
    }
  }
  saveBlocklist(nextBlocklist, "emergency");

  const outcomes = targets.map((snapshot) => ({
    player: snapshot,
    outcome: kickPlayerBySnapshot(snapshot, "Emergency sweep by SpamTrace")
  }));

  emit(
    "emergency_sweep",
    { reason: reason || "", trustlist, targets, outcomes },
    { notify: true, detail: `targets=${targets.length}` }
  );
  sendPrivate(sender, `\u7dca\u6025\u6392\u9664\u3092\u5b9f\u884c\u3057\u307e\u3057\u305f: ${targets.length}\u4eba`);
}

function isPendingApproval(snapshot) {
  if (!snapshot || !snapshot.name) {
    return false;
  }

  if (findMatchingEntry(snapshot, loadBlocklist())) {
    return false;
  }

  if (isSnapshotTrusted(snapshot, loadTrustlist())) {
    return false;
  }

  return true;
}

function logEvidenceMarker(sender, note, source = "manual") {
  const snapshot = snapshotPlayer(sender);
  emit(
    "evidence_marker",
    {
      source,
      note: note || "marker",
      admin: snapshot,
      settings: loadSettings(),
      roster: rosterSummary()
    },
    { notify: true, detail: `${snapshot.name} marker` }
  );
}

function sendHelp(sender) {
  sendLines(sender, [
    "SpamTrace \u7ba1\u7406\u30b3\u30de\u30f3\u30c9",
    "!st help",
    "!st status",
    "!st who",
    "!st list",
    "!st trusted",
    "!st settings",
    "!st export",
    "!st scan",
    "!st block name <exactName> [reason]",
    "!st blockid <playerId> [reason]",
    "!st unblock <nameOrId>",
    "!st trust name <exactName> [reason]",
    "!st trustid <playerId> [reason]",
    "!st untrust <nameOrId>",
    "!st kick <exactName>",
    "!st kickid <playerId>",
    "!st quarantine <exactName> [reason]",
    "!st quarantineid <playerId> [reason]",
    "!st lockdown on|off|status",
    "!st autoblock on|off|status",
    "!st chatgate on|off|status",
    "!st evidence on|off|status",
    "!st mark <note>",
    "!st emergency [reason]"
  ]);
}

function handleAdminCommand(event) {
  const message = String(event.message || "").trim();
  if (!message.startsWith("!st") && !message.startsWith(":st")) {
    return false;
  }

  event.cancel = true;
  const sender = event.sender;
  if (!loadAdminOwner() && safeCall(() => sender.hasTag(ADMIN_TAG), false)) {
    tryBootstrapAdminOwner("tag-bootstrap", sender);
  }

  if (!isAdminPlayer(sender)) {
    sendPrivate(sender, "\u7ba1\u7406\u8005\u3068\u3057\u3066\u8a8d\u8a3c\u3055\u308c\u3066\u3044\u307e\u305b\u3093");
    return true;
  }

  const args = parseArgs(message.slice(3).trim());
  const subcommand = (args[0] || "help").toLowerCase();

  if (subcommand === "help") {
    sendHelp(sender);
    return true;
  }

  if (subcommand === "status") {
    const snapshot = snapshotPlayer(sender);
    const owner = loadAdminOwner();
    sendLines(sender, [
      `\u3042\u306a\u305f: ${snapshot.name} / id=${snapshot.id}`,
      `\u30aa\u30f3\u30e9\u30a4\u30f3: ${getPlayers().length}\u4eba / \u30d6\u30ed\u30c3\u30af: ${loadBlocklist().length}\u4ef6 / \u4fe1\u983c: ${loadTrustlist().length}\u4ef6`,
      `\u8a2d\u5b9a: ${describeSettings(loadSettings())}`,
      `\u7ba1\u7406\u8005: ${owner ? `${owner.playerName} / ${owner.playerId}` : "未設定"}`
    ]);
    return true;
  }

  if (subcommand === "who") {
    sendLines(sender, formatOnlinePlayers());
    return true;
  }

  if (subcommand === "settings") {
    sendPrivate(sender, `\u8a2d\u5b9a: ${describeSettings(loadSettings())}`);
    return true;
  }

  if (subcommand === "list") {
    sendLines(sender, formatEntries(loadBlocklist(), "\u30d6\u30ed\u30c3\u30af\u30ea\u30b9\u30c8\u306f\u7a7a\u3067\u3059"));
    return true;
  }

  if (subcommand === "trusted") {
    sendLines(sender, formatEntries(loadTrustlist(), "\u4fe1\u983c\u30ea\u30b9\u30c8\u306f\u7a7a\u3067\u3059"));
    return true;
  }

  if (subcommand === "export") {
    exportState(sender);
    return true;
  }

  if (subcommand === "scan") {
    emit(
      "manual_scan",
      {
        roster: rosterSummary(),
        blocklist: loadBlocklist(),
        trustlist: loadTrustlist(),
        settings: loadSettings()
      },
      { notify: true, detail: "manual scan" }
    );
    sendPrivate(sender, "\u624b\u52d5\u30b9\u30ad\u30e3\u30f3\u3092\u8a18\u9332\u3057\u307e\u3057\u305f");
    return true;
  }

  if (subcommand === "block" && (args[1] || "").toLowerCase() === "name") {
    const name = args[2];
    const reason = args.slice(3).join(" ");
    if (!name) {
      sendPrivate(sender, "\u4f7f\u3044\u65b9: !st block name <exactName> [reason]");
      return true;
    }
    addBlockEntry(sender, { name, reason, source: "manual-name" });
    return true;
  }

  if (subcommand === "blockid") {
    const id = args[1];
    const reason = args.slice(2).join(" ");
    if (!id) {
      sendPrivate(sender, "\u4f7f\u3044\u65b9: !st blockid <playerId> [reason]");
      return true;
    }
    addBlockEntry(sender, { id, reason, source: "manual-id" });
    return true;
  }

  if (subcommand === "unblock") {
    removeBlockEntry(sender, args[1]);
    return true;
  }

  if (subcommand === "trust" && (args[1] || "").toLowerCase() === "name") {
    const name = args[2];
    const reason = args.slice(3).join(" ");
    if (!name) {
      sendPrivate(sender, "\u4f7f\u3044\u65b9: !st trust name <exactName> [reason]");
      return true;
    }
    addTrustEntry(sender, { name, reason, source: "manual-name" });
    return true;
  }

  if (subcommand === "trustid") {
    const id = args[1];
    const reason = args.slice(2).join(" ");
    if (!id) {
      sendPrivate(sender, "\u4f7f\u3044\u65b9: !st trustid <playerId> [reason]");
      return true;
    }
    addTrustEntry(sender, { id, reason, source: "manual-id" });
    return true;
  }

  if (subcommand === "untrust") {
    removeTrustEntry(sender, args[1]);
    return true;
  }

  if (subcommand === "kick") {
    const name = args[1];
    if (!name) {
      sendPrivate(sender, "\u4f7f\u3044\u65b9: !st kick <exactName>");
      return true;
    }
    const outcome = kickPlayerBySnapshot({ name });
    sendPrivate(sender, outcome.ok ? `\u30ad\u30c3\u30af\u3092\u9001\u4fe1\u3057\u307e\u3057\u305f: ${name}` : `\u30ad\u30c3\u30af\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${name}`);
    emit("manual_kick", { name, outcome }, { notify: !outcome.ok, detail: `kick ${name}` });
    return true;
  }

  if (subcommand === "kickid") {
    const id = args[1];
    if (!id) {
      sendPrivate(sender, "\u4f7f\u3044\u65b9: !st kickid <playerId>");
      return true;
    }
    const player = findOnlinePlayerById(id);
    if (!player) {
      sendPrivate(sender, `\u305d\u306e player id \u306f\u73fe\u5728\u30aa\u30f3\u30e9\u30a4\u30f3\u3067\u306f\u3042\u308a\u307e\u305b\u3093: ${id}`);
      return true;
    }
    const snapshot = snapshotPlayer(player);
    const outcome = kickPlayerBySnapshot(snapshot);
    sendPrivate(sender, outcome.ok ? `\u30ad\u30c3\u30af\u3092\u9001\u4fe1\u3057\u307e\u3057\u305f: ${snapshot.name}` : `\u30ad\u30c3\u30af\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${snapshot.name}`);
    emit("manual_kick", { id, player: snapshot, outcome }, { notify: !outcome.ok, detail: `kickid ${id}` });
    return true;
  }

  if (subcommand === "quarantine") {
    const name = args[1];
    const reason = args.slice(2).join(" ");
    if (!name) {
      sendPrivate(sender, "\u4f7f\u3044\u65b9: !st quarantine <exactName> [reason]");
      return true;
    }
    const online = findOnlinePlayerByName(name);
    const snapshot = online ? snapshotPlayer(online) : { id: null, name, nameTag: name };
    quarantineSnapshot(sender, snapshot, reason, "manual-quarantine-name");
    return true;
  }

  if (subcommand === "quarantineid") {
    const id = args[1];
    const reason = args.slice(2).join(" ");
    if (!id) {
      sendPrivate(sender, "\u4f7f\u3044\u65b9: !st quarantineid <playerId> [reason]");
      return true;
    }
    const player = findOnlinePlayerById(id);
    if (!player) {
      sendPrivate(sender, `\u305d\u306e player id \u306f\u73fe\u5728\u30aa\u30f3\u30e9\u30a4\u30f3\u3067\u306f\u3042\u308a\u307e\u305b\u3093: ${id}`);
      return true;
    }
    quarantineSnapshot(sender, snapshotPlayer(player), reason, "manual-quarantine-id");
    return true;
  }

  if (subcommand === "lockdown") {
    const mode = (args[1] || "status").toLowerCase();
    if (mode === "status") {
      sendPrivate(sender, `\u30ed\u30c3\u30af\u30c0\u30a6\u30f3: ${loadSettings().lockdown ? "on" : "off"}`);
      return true;
    }
    if (mode === "on") {
      setBooleanSetting(sender, "lockdown", true, "manual-lockdown");
      return true;
    }
    if (mode === "off") {
      setBooleanSetting(sender, "lockdown", false, "manual-lockdown");
      return true;
    }
    sendPrivate(sender, "\u4f7f\u3044\u65b9: !st lockdown on|off|status");
    return true;
  }

  if (subcommand === "autoblock") {
    const mode = (args[1] || "status").toLowerCase();
    if (mode === "status") {
      sendPrivate(sender, `\u81ea\u52d5\u30d6\u30ed\u30c3\u30af: ${loadSettings().autoBlockSuspicious ? "on" : "off"}`);
      return true;
    }
    if (mode === "on") {
      setBooleanSetting(sender, "autoBlockSuspicious", true, "manual-autoblock");
      return true;
    }
    if (mode === "off") {
      setBooleanSetting(sender, "autoBlockSuspicious", false, "manual-autoblock");
      return true;
    }
    sendPrivate(sender, "\u4f7f\u3044\u65b9: !st autoblock on|off|status");
    return true;
  }

  if (subcommand === "chatgate") {
    const mode = (args[1] || "status").toLowerCase();
    if (mode === "status") {
      sendPrivate(sender, `\u627f\u8a8d\u5f85\u3061\u30c1\u30e3\u30c3\u30c8\u5236\u9650: ${loadSettings().chatGate ? "on" : "off"}`);
      return true;
    }
    if (mode === "on") {
      setBooleanSetting(sender, "chatGate", true, "manual-chatgate");
      return true;
    }
    if (mode === "off") {
      setBooleanSetting(sender, "chatGate", false, "manual-chatgate");
      return true;
    }
    sendPrivate(sender, "\u4f7f\u3044\u65b9: !st chatgate on|off|status");
    return true;
  }

  if (subcommand === "evidence") {
    const mode = (args[1] || "status").toLowerCase();
    if (mode === "status") {
      sendPrivate(sender, `\u8a3c\u62e0\u30e2\u30fc\u30c9: ${loadSettings().evidenceMode ? "on" : "off"}`);
      return true;
    }
    if (mode === "on") {
      setBooleanSetting(sender, "evidenceMode", true, "manual-evidence");
      return true;
    }
    if (mode === "off") {
      setBooleanSetting(sender, "evidenceMode", false, "manual-evidence");
      return true;
    }
    sendPrivate(sender, "\u4f7f\u3044\u65b9: !st evidence on|off|status");
    return true;
  }

  if (subcommand === "mark") {
    const note = args.slice(1).join(" ");
    logEvidenceMarker(sender, note || "manual marker", "manual-mark");
    sendPrivate(sender, "\u8a3c\u62e0\u30de\u30fc\u30ab\u30fc\u3092\u8a18\u9332\u3057\u307e\u3057\u305f");
    return true;
  }

  if (subcommand === "emergency") {
    emergencySweep(sender, args.slice(1).join(" "));
    return true;
  }

  sendHelp(sender);
  return true;
}

function scheduleJoinResolution(event, delayTicks) {
  system.runTimeout(() => {
    const player = findPlayerByJoinData(event.playerId, event.playerName);
    if (!player) {
      emit(
        "join_resolve_miss",
        {
          delayTicks,
          playerId: event.playerId,
          playerName: event.playerName,
          roster: rosterSummary()
        },
        { notify: true, detail: truncate(`${event.playerName} missing after ${delayTicks}t`, 120) }
      );
      return;
    }

    const snapshot = snapshotPlayer(player);
    const reasons = detectPlayerAnomalies(snapshot);
    emit(
      "join_resolved",
      {
        delayTicks,
        join: {
          playerId: event.playerId,
          playerName: event.playerName
        },
        player: snapshot,
        reasons,
        trustMatch: findMatchingEntry(snapshot, loadTrustlist()),
        blockMatch: findMatchingEntry(snapshot, loadBlocklist()),
        settings: loadSettings(),
        roster: rosterSummary()
      },
      { notify: reasons.length > 0, detail: truncate(`${snapshot.name} ${reasons.join(",")}`, 120) }
    );

    if (loadSettings().chatGate && isPendingApproval(snapshot)) {
      emit(
        "pending_approval",
        {
          player: snapshot,
          settings: loadSettings(),
          roster: rosterSummary()
        },
        { notify: true, detail: `${snapshot.name} pending approval` }
      );
    }

    enforcePolicy(player, `join_resolved_${delayTicks}`);
  }, delayTicks);
}

function subscribeJoin() {
  if (!world.afterEvents.playerJoin) {
    emit("feature_missing", { event: "playerJoin" }, { notify: true, detail: "playerJoin unavailable" });
    return;
  }

  world.afterEvents.playerJoin.subscribe((event) => {
    const rawReasons = [];
    if (!event.playerName || event.playerName.trim().length === 0) {
      rawReasons.push("blank_name");
    }
    if (event.playerName && event.playerName.length <= 1) {
      rawReasons.push("very_short_name");
    }

    emit(
      "player_join",
      {
        playerId: event.playerId,
        playerName: event.playerName,
        rawReasons,
        settings: loadSettings(),
        roster: rosterSummary(),
        blocklist: loadBlocklist(),
        trustlist: loadTrustlist()
      },
      { notify: rawReasons.length > 0, detail: truncate(`${event.playerName} ${rawReasons.join(",")}`, 120) }
    );

    scheduleJoinResolution(event, 1);
    scheduleJoinResolution(event, 20);
    scheduleJoinResolution(event, 100);
  });
}

function subscribeLeave() {
  const leaveStream = world.afterEvents.playerLeave;
  if (!leaveStream) {
    emit("feature_missing", { event: "playerLeave" }, { notify: true, detail: "playerLeave unavailable" });
    return;
  }

  leaveStream.subscribe((event) => {
    emit("player_leave", {
      playerId: event.playerId,
      playerName: event.playerName,
      roster: rosterSummary()
    });
  });
}

function subscribeSpawn() {
  if (!world.afterEvents.playerSpawn) {
    emit("feature_missing", { event: "playerSpawn" }, { notify: true, detail: "playerSpawn unavailable" });
    return;
  }

  world.afterEvents.playerSpawn.subscribe((event) => {
    tryBootstrapAdminOwner("spawn-bootstrap", event.player);

    const snapshot = snapshotPlayer(event.player);
    const reasons = detectPlayerAnomalies(snapshot);
    const isInitialSpawn = event.initialSpawn === true;

    if (isInitialSpawn || reasons.length > 0) {
      emit(
        "player_spawn",
        {
          initialSpawn: isInitialSpawn,
          player: snapshot,
          reasons,
          settings: loadSettings(),
          roster: rosterSummary()
        },
        { notify: true, detail: truncate(`${snapshot.name} spawn ${reasons.join(",")}`, 120) }
      );
    }

    enforcePolicy(event.player, "spawn");
  });
}

function subscribeChat() {
  if (!world.beforeEvents.chatSend) {
    emit("feature_missing", { event: "chatSend" }, { notify: true, detail: "chatSend unavailable" });
    return;
  }

  world.beforeEvents.chatSend.subscribe((event) => {
    if (handleAdminCommand(event)) {
      return;
    }

    const snapshot = snapshotPlayer(event.sender);
    const trustlist = loadTrustlist();
    const settings = loadSettings();
    const trusted = isSnapshotTrusted(snapshot, trustlist);
    const blockMatch = findMatchingEntry(snapshot, loadBlocklist());

    if (settings.evidenceMode) {
      emit("chat_observed", {
        player: snapshot,
        message: event.message,
        trusted,
        blockMatch,
        settings,
        roster: rosterSummary()
      });
    }

    if (enforcePolicy(event.sender, "chat")) {
      event.cancel = true;
      return;
    }

    if (settings.chatGate && !trusted) {
      event.cancel = true;
      emit(
        "chat_gate_block",
        {
          player: snapshot,
          message: event.message,
          settings,
          roster: rosterSummary()
        },
        { notify: true, detail: `${snapshot.name} chat gate` }
      );
      sendPrivate(event.sender, "\u7ba1\u7406\u8005\u306b\u627f\u8a8d\u3055\u308c\u308b\u307e\u3067\u30c1\u30e3\u30c3\u30c8\u3067\u304d\u307e\u305b\u3093");
      return;
    }

    const playerReasons = detectPlayerAnomalies(snapshot);
    const messageReasons = detectMessageAnomalies(event.message);

    if (playerReasons.length === 0 && messageReasons.length === 0) {
      return;
    }

    emit(
      "suspicious_chat",
      {
        player: snapshot,
        playerReasons,
        message: event.message,
        messageReasons,
        settings,
        trusted,
        roster: rosterSummary()
      },
      { notify: true, detail: truncate(`${snapshot.name} ${messageReasons.concat(playerReasons).join(",")}`, 120) }
    );

    if (!settings.autoBlockSuspicious) {
      return;
    }

    event.cancel = true;
    addBlockEntry(event.sender, {
      id: snapshot.id ?? null,
      name: snapshot.name ?? null,
      reason: `auto:${messageReasons.concat(playerReasons).join(",") || "suspicious"}`,
      source: "auto-suspicious"
    });
    const outcome = kickPlayerBySnapshot(snapshot, "Auto blocked by SpamTrace");
    emit(
      "auto_block_suspicious",
      {
        player: snapshot,
        playerReasons,
        message: event.message,
        messageReasons,
        outcome
      },
      { notify: true, detail: `${snapshot.name} auto blocked` }
    );
  });
}

function startAnomalyScan() {
  system.runInterval(() => {
    const seenIds = new Set();

    for (const player of getPlayers()) {
      const snapshot = snapshotPlayer(player);
      const reasons = detectPlayerAnomalies(snapshot);
      const cacheKey = snapshot.id || snapshot.name || "unknown-player";
      seenIds.add(cacheKey);

      enforcePolicy(player, "interval");

      if (reasons.length === 0) {
        anomalyCache.delete(cacheKey);
        continue;
      }

      const signature = jsonLine({
        id: snapshot.id,
        name: snapshot.name,
        nameTag: snapshot.nameTag,
        reasons
      });

      if (anomalyCache.get(cacheKey) === signature) {
        continue;
      }

      anomalyCache.set(cacheKey, signature);
      emit(
        "player_anomaly_scan",
        {
          player: snapshot,
          reasons,
          settings: loadSettings(),
          roster: rosterSummary()
        },
        { notify: true, detail: truncate(`${snapshot.name} ${reasons.join(",")}`, 120) }
      );
    }

    for (const cacheKey of Array.from(anomalyCache.keys())) {
      if (!seenIds.has(cacheKey)) {
        anomalyCache.delete(cacheKey);
      }
    }
  }, 100);
}

function announceReady() {
  system.runTimeout(() => {
    const owner = tryBootstrapAdminOwner("ready-bootstrap");
    emit("trace_logger_ready", {
      version: TRACE_VERSION,
      adminTag: ADMIN_TAG,
      adminOwner: owner,
      watchedScores: WATCHED_SCORES,
      settings: loadSettings(),
      blocklist: loadBlocklist(),
      trustlist: loadTrustlist(),
      playersOnline: rosterSummary()
    });

    if (owner) {
      notifyAdmins(`\u6e96\u5099\u5b8c\u4e86 version=${TRACE_VERSION} owner=${owner.playerName}`);
      return;
    }

    notifyAdmins(`\u6e96\u5099\u5b8c\u4e86 version=${TRACE_VERSION} owner=unbound`);
    emit(
      "admin_owner_unbound",
      {
        reason: "no_unique_player",
        playersOnline: rosterSummary(),
        settings: loadSettings()
      },
      { notify: true, detail: "admin owner unbound" }
    );
  }, 20);
}

subscribeJoin();
subscribeLeave();
subscribeSpawn();
subscribeChat();
startAnomalyScan();
announceReady();
