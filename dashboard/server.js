const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const REPORTS_DIR = path.join(ROOT, "reports");
const SEND_SCRIPT = path.join(ROOT, "scripts", "send-to-minecraft.ps1");
const NETWORK_SCRIPT = path.join(ROOT, "scripts", "network-snapshot.ps1");
const TRACE_PREFIX = "[SpamTrace]";
const PORT = Number(process.env.SPAMTRACE_PORT || 3984);
const HOST = "127.0.0.1";
const DASHBOARD_URL = `http://${HOST}:${PORT}`;
const AUTO_OPEN_BROWSER = process.env.SPAMTRACE_OPEN_BROWSER !== "0";
const MAX_LOG_BYTES = 1_500_000;
const LOG_FILE_LIMIT = 4;
const EVENT_LIMIT = 180;
const DEFAULT_SETTINGS = {
  lockdown: false,
  autoBlockSuspicious: false
};

const stateCache = {
  signature: null,
  value: null
};

let browserOpened = false;

function exists(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

function detectChromeExecutable() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe")
  ].filter(Boolean);

  return candidates.find((candidate) => exists(candidate)) || null;
}

function openDashboardBrowser(url) {
  if (!AUTO_OPEN_BROWSER || browserOpened) {
    return;
  }

  browserOpened = true;
  const chromePath = detectChromeExecutable();

  try {
    if (chromePath) {
      const child = spawn(chromePath, [url], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      child.unref();
      console.log(`[SpamTrace UI] browser=chrome url=${url}`);
      return;
    }

    const child = spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    console.log(`[SpamTrace UI] browser=default url=${url}`);
  } catch (error) {
    browserOpened = false;
    console.warn(`[SpamTrace UI] browser open failed: ${error.message}`);
  }
}

function detectLogDir() {
  const home = os.homedir();
  const candidates = [
    path.join(home, "AppData", "Roaming", "Minecraft Bedrock", "logs"),
    path.join(
      home,
      "AppData",
      "Local",
      "Packages",
      "Microsoft.MinecraftUWP_8wekyb3d8bbwe",
      "LocalState",
      "logs"
    )
  ];

  return candidates.find((candidate) => exists(candidate)) || null;
}

function listContentLogs(logDir) {
  if (!logDir || !exists(logDir)) {
    return [];
  }

  return fs
    .readdirSync(logDir)
    .filter((name) => /^ContentLog.*\.txt$/i.test(name))
    .map((name) => {
      const fullPath = path.join(logDir, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        fullPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        mtimeIso: new Date(stat.mtimeMs).toISOString()
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function readUtf8Tail(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, "r");

  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }

  return buffer.toString("utf8");
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseSpamTraceEvents(fileInfo) {
  const text = readUtf8Tail(fileInfo.fullPath, MAX_LOG_BYTES);
  const lines = text.split(/\r?\n/);
  const events = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const markerIndex = rawLine.indexOf(TRACE_PREFIX);
    if (markerIndex < 0) {
      continue;
    }

    const traceText = rawLine.slice(markerIndex + TRACE_PREFIX.length).trim();
    const match = traceText.match(/^(\S+)\s+([a-z_]+)\s+([\s\S]+)$/);
    if (!match) {
      events.push({
        eventId: `${fileInfo.name}:${index + 1}`,
        occurredAt: fileInfo.mtimeIso,
        timeMs: fileInfo.mtimeMs + index,
        label: "parse_error",
        payload: {
          raw: traceText
        },
        sourceFile: fileInfo.name,
        lineNumber: index + 1,
        rawLine
      });
      continue;
    }

    const occurredAt = match[1];
    const label = match[2];
    const payloadText = match[3];
    const parsedPayload = parseJsonSafe(payloadText);
    const timeMs = Number.isFinite(Date.parse(occurredAt)) ? Date.parse(occurredAt) : fileInfo.mtimeMs + index;

    events.push({
      eventId: `${fileInfo.name}:${index + 1}`,
      occurredAt,
      timeMs,
      label,
      payload: parsedPayload ?? { raw: payloadText },
      sourceFile: fileInfo.name,
      lineNumber: index + 1,
      rawLine
    });
  }

  return events;
}

function makePlayerRecord(key) {
  return {
    key,
    id: null,
    name: null,
    nameTag: null,
    firstSeenAt: null,
    lastSeenAt: null,
    lastEventLabel: null,
    joinCount: 0,
    leaveCount: 0,
    spawnCount: 0,
    suspiciousCount: 0,
    anomalyCount: 0,
    blockHitCount: 0,
    blocklisted: false,
    lastMessage: null,
    lastLocation: null,
    lastDimension: null,
    reasons: new Set(),
    messageReasons: new Set(),
    tags: new Set(),
    scores: {},
    indicatorTags: new Set()
  };
}

function snapshotFromEvent(event) {
  const payload = event.payload || {};

  if (payload.player && typeof payload.player === "object") {
    return payload.player;
  }

  if (payload.playerId || payload.playerName) {
    return {
      id: payload.playerId ?? null,
      name: payload.playerName ?? null,
      nameTag: payload.playerName ?? null
    };
  }

  if (payload.name || payload.id) {
    return {
      id: payload.id ?? null,
      name: payload.name ?? null,
      nameTag: payload.name ?? null
    };
  }

  return null;
}

function upsertPlayer(players, idIndex, nameIndex, snapshot) {
  const rawId = typeof snapshot?.id === "string" && snapshot.id.trim() ? snapshot.id.trim() : null;
  const rawName = typeof snapshot?.name === "string" && snapshot.name.trim() ? snapshot.name.trim() : null;

  let key = null;
  if (rawId && idIndex.has(rawId)) {
    key = idIndex.get(rawId);
  } else if (rawName && nameIndex.has(rawName)) {
    key = nameIndex.get(rawName);
  } else if (rawId) {
    key = `id:${rawId}`;
  } else if (rawName) {
    key = `name:${rawName}`;
  } else {
    key = `unknown:${players.size + 1}`;
  }

  if (!players.has(key)) {
    players.set(key, makePlayerRecord(key));
  }

  if (rawId) {
    idIndex.set(rawId, key);
  }
  if (rawName) {
    nameIndex.set(rawName, key);
  }

  return players.get(key);
}

function mergeSnapshotIntoRecord(record, snapshot, event) {
  if (snapshot.id) {
    record.id = snapshot.id;
  }
  if (snapshot.name) {
    record.name = snapshot.name;
  }
  if (snapshot.nameTag) {
    record.nameTag = snapshot.nameTag;
  }
  if (snapshot.dimension) {
    record.lastDimension = snapshot.dimension;
  }
  if (snapshot.location) {
    record.lastLocation = snapshot.location;
  }
  if (Array.isArray(snapshot.tags)) {
    for (const tag of snapshot.tags) {
      record.tags.add(tag);
    }
  }
  if (snapshot.scores && typeof snapshot.scores === "object") {
    record.scores = snapshot.scores;
  }

  record.firstSeenAt = record.firstSeenAt || event.occurredAt;
  record.lastSeenAt = event.occurredAt;
  record.lastEventLabel = event.label;
}

function applyEventToRecord(record, event) {
  const payload = event.payload || {};
  const playerReasons = Array.isArray(payload.playerReasons) ? payload.playerReasons : [];
  const messageReasons = Array.isArray(payload.messageReasons) ? payload.messageReasons : [];
  const directReasons = Array.isArray(payload.reasons) ? payload.reasons : [];

  if (event.label === "player_join") {
    record.joinCount += 1;
  }
  if (event.label === "player_leave") {
    record.leaveCount += 1;
  }
  if (event.label === "player_spawn") {
    record.spawnCount += 1;
  }
  if (event.label === "suspicious_chat") {
    record.suspiciousCount += 1;
    record.lastMessage = typeof payload.message === "string" ? payload.message : record.lastMessage;
  }
  if (event.label === "player_anomaly_scan") {
    record.anomalyCount += 1;
  }
  if (event.label === "blocklist_match") {
    record.blockHitCount += 1;
  }

  for (const reason of playerReasons.concat(directReasons)) {
    record.reasons.add(reason);
  }
  for (const reason of messageReasons) {
    record.messageReasons.add(reason);
  }

  if (record.messageReasons.has("lumineproxy") || record.messageReasons.has("external_label")) {
    record.indicatorTags.add("外部クライアント疑い");
  }
  if (record.messageReasons.has("discord_invite")) {
    record.indicatorTags.add("宣伝スパム疑い");
  }
  if (record.reasons.has("nameTag_mismatch") || record.reasons.has("quoted_name") || record.reasons.has("blank_name")) {
    record.indicatorTags.add("表示名異常");
  }
  if (record.blockHitCount > 0) {
    record.indicatorTags.add("ブロック一致");
  }
}

function deriveBlocklist(events) {
  let latest = [];

  for (const event of events) {
    const payload = event.payload || {};
    if (Array.isArray(payload.blocklist)) {
      latest = payload.blocklist;
    } else if (Array.isArray(payload.entries)) {
      latest = payload.entries;
    }
  }

  return latest
    .map((entry) => ({
      id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : null,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : null,
      reason: typeof entry.reason === "string" ? entry.reason : "",
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : null,
      source: typeof entry.source === "string" ? entry.source : null
    }))
    .filter((entry) => entry.id || entry.name);
}

function deriveTrustlist(events) {
  let latest = [];

  for (const event of events) {
    const payload = event.payload || {};
    if (Array.isArray(payload.trustlist)) {
      latest = payload.trustlist;
    } else if (event.label === "trustlist_updated" && Array.isArray(payload.entries)) {
      latest = payload.entries;
    }
  }

  return latest
    .map((entry) => ({
      id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : null,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : null,
      reason: typeof entry.reason === "string" ? entry.reason : "",
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : null,
      source: typeof entry.source === "string" ? entry.source : null
    }))
    .filter((entry) => entry.id || entry.name);
}

function deriveSettings(events) {
  let latest = { ...DEFAULT_SETTINGS };

  for (const event of events) {
    const payload = event.payload || {};
    if (!payload.settings || typeof payload.settings !== "object") {
      continue;
    }

    latest = {
      lockdown: payload.settings.lockdown === true,
      autoBlockSuspicious: payload.settings.autoBlockSuspicious === true
    };
  }

  return latest;
}

function buildPlayers(events, blocklist, trustlist) {
  const players = new Map();
  const idIndex = new Map();
  const nameIndex = new Map();

  for (const event of events) {
    const snapshot = snapshotFromEvent(event);
    if (!snapshot) {
      continue;
    }

    const record = upsertPlayer(players, idIndex, nameIndex, snapshot);
    mergeSnapshotIntoRecord(record, snapshot, event);
    applyEventToRecord(record, event);
  }

  for (const record of players.values()) {
    record.blocklisted = blocklist.some((entry) => {
      return (record.id && entry.id === record.id) || (record.name && entry.name === record.name);
    });
    record.trusted = trustlist.some((entry) => {
      return (record.id && entry.id === record.id) || (record.name && entry.name === record.name);
    });

    if (record.blocklisted) {
      record.indicatorTags.add("ブロック登録済み");
    }

    record.reasons = Array.from(record.reasons);
    record.messageReasons = Array.from(record.messageReasons);
    record.tags = Array.from(record.tags);
    record.indicatorTags = Array.from(record.indicatorTags);
    record.score =
      record.suspiciousCount * 5 +
      record.anomalyCount * 3 +
      record.blockHitCount * 8 +
      (record.blocklisted ? 4 : 0) +
      record.messageReasons.length * 2 +
      record.reasons.length;
  }

  return Array.from(players.values()).sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return (right.lastSeenAt || "").localeCompare(left.lastSeenAt || "");
  });
}

function buildState() {
  const logDir = detectLogDir();
  if (!logDir) {
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      summary: {
        events: 0,
        suspiciousEvents: 0,
        trackedPlayers: 0,
        blocklistEntries: 0
      },
      players: [],
      events: [],
      blocklist: [],
      logDir: null,
      files: [],
      caveats: [
        "Content Log ディレクトリが見つかりません。Bedrock を一度起動して Content Log を有効にしてください。"
      ]
    };
  }

  const files = listContentLogs(logDir).slice(0, LOG_FILE_LIMIT);
  const signature = files.map((file) => `${file.name}:${file.size}:${file.mtimeMs}`).join("|");
  if (signature && signature === stateCache.signature && stateCache.value) {
    return stateCache.value;
  }

  const events = files
    .slice()
    .reverse()
    .flatMap((file) => parseSpamTraceEvents(file))
    .sort((left, right) => left.timeMs - right.timeMs);

  const blocklist = deriveBlocklist(events);
  const trustlist = deriveTrustlist(events);
  const settings = deriveSettings(events);
  const players = buildPlayers(events, blocklist, trustlist);
  const visibleEvents = events.slice(-EVENT_LIMIT).reverse();
  const suspiciousEvents = events.filter((event) => {
    return event.label === "suspicious_chat" || event.label === "player_anomaly_scan" || event.label === "blocklist_match";
  }).length;

  const value = {
    ok: true,
    generatedAt: new Date().toISOString(),
    logDir,
    files,
    blocklist,
    trustlist,
    settings,
    players,
    events: visibleEvents,
    summary: {
      events: events.length,
      suspiciousEvents,
      trackedPlayers: players.length,
      blocklistEntries: blocklist.length
    },
    caveats: [
      "この UI は Content Log に出た SpamTrace 情報だけを使います。",
      "ローカルワールドでは、参加者の本当の IP や Microsoft リレーの内側までは確定できません。",
      "ここで見える通信先はホスト PC 視点の観測であり、犯人の真の送信元を保証しません。"
    ]
  };

  stateCache.signature = signature;
  stateCache.value = value;
  return value;
}

async function runPowerShellFile(filePath, args = []) {
  const { stdout, stderr } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filePath, ...args],
    {
      windowsHide: true,
      cwd: ROOT,
      maxBuffer: 1024 * 1024
    }
  );

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim()
  };
}

async function getNetworkSnapshot() {
  if (!exists(NETWORK_SCRIPT)) {
    return {
      ok: false,
      message: "network-snapshot.ps1 が見つかりません"
    };
  }

  try {
    const result = await runPowerShellFile(NETWORK_SCRIPT);
    const parsed = parseJsonSafe(result.stdout);
    return {
      ok: true,
      ...parsed,
      stderr: result.stderr || null
    };
  } catch (error) {
    return {
      ok: false,
      message: error.message
    };
  }
}

async function sendCommandToMinecraft(command) {
  if (!exists(SEND_SCRIPT)) {
    return {
      ok: false,
      message: "send-to-minecraft.ps1 が見つかりません"
    };
  }

  try {
    const result = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", SEND_SCRIPT, "-Command", command],
      {
        windowsHide: true,
        cwd: ROOT,
        maxBuffer: 1024 * 1024
      }
    );

    return parseJsonSafe(result.stdout.trim()) || {
      ok: true,
      command,
      raw: result.stdout.trim()
    };
  } catch (error) {
    return {
      ok: false,
      command,
      message: error.message
    };
  }
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function sendText(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function serveStatic(requestPath, response) {
  const relativePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.join(PUBLIC_DIR, relativePath);
  const normalized = path.normalize(filePath);

  if (!normalized.startsWith(PUBLIC_DIR) || !exists(normalized) || fs.statSync(normalized).isDirectory()) {
    sendText(response, 404, "Not found");
    return;
  }

  const ext = path.extname(normalized).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  sendText(response, 200, fs.readFileSync(normalized), contentTypes[ext] || "application/octet-stream");
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) {
        reject(new Error("Body が大きすぎます"));
      }
    });
    request.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);

  if (request.method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, buildState());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/network") {
    sendJson(response, 200, await getNetworkSnapshot());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/command") {
    try {
      const body = await readJsonBody(request);
      const command = typeof body.command === "string" ? body.command.trim() : "";

      if (!command) {
        sendJson(response, 400, { ok: false, message: "command が空です" });
        return;
      }

      if (!command.startsWith("!st") && !command.startsWith("/")) {
        sendJson(response, 400, { ok: false, message: "送信できるのは !st または / から始まるコマンドだけです" });
        return;
      }

      sendJson(response, 200, await sendCommandToMinecraft(command));
      return;
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message });
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      generatedAt: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET") {
    serveStatic(url.pathname, response);
    return;
  }

  sendText(response, 405, "Method not allowed");
});

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(`[SpamTrace UI] http://${HOST}:${PORT} is already in use. Another dashboard instance may already be running.`);
    process.exit(0);
  }

  console.error(error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[SpamTrace UI] ${DASHBOARD_URL}`);
  openDashboardBrowser(DASHBOARD_URL);
});
