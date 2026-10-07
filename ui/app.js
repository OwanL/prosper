import { setupLayout } from './layout.js';
import { sampleMotion, createMotionClock } from './motion.js';
import { strategyProgress } from '../lib/strategy-progress.mjs';
import { BREAD_NUTRITION } from '../lib/economy.mjs';

const POLL_INTERVALS = { 1: 750, 3: 250, 8: 100 };
const POLL_BACKOFF_MAX = 8000;
const FALLBACK_COLOR = "#66815f";
const $ = (selector) => document.querySelector(selector);
const ui = {
  headerDot: $("#header-state-dot"), headerLabel: $("#header-state-label"), tick: $("#tick-label"), population: $("#population-label"), budgetMini: $("#budget-mini"),
  play: $("#play-button"), pause: $("#pause-button"), reset: $("#reset-button"), speed: $("#speed-select"), retry: $("#retry-button"), banner: $("#connection-banner"), bannerText: $("#connection-message"),
  clock: $("#world-clock"), mapBoard: $("#map-board"), tileField: $("#tile-field"), overlay: $("#map-overlay"), resourceLayer: $("#resource-layer"), citizenLayer: $("#citizen-layer"),
  overviewMode: $("#overview-mode"), citizenMode: $("#citizen-mode"), viewNote: $("#map-view-note"), geographyNote: $("#map-geography"), mapHint: $("#map-hint"),
  buildingLayer: $("#building-layer"), actionLayer: $("#action-layer"),
  citizenCount: $("#citizen-count"), citizenList: $("#citizen-list"), inspectorTitle: $("#inspector-title"), inspectorContent: $("#inspector-content"), planningChip: $("#planning-chip"),
  communicationColumns: Object.fromEntries(['trades', 'private', 'public'].map(kind => [kind, {
    list: $(`#${kind}-list`), count: $(`#${kind}-count`), empty: $(`#${kind}-empty`),
  } ])),
  eventList: $("#event-list"), eventsEmpty: $("#events-empty"),
  model: $("#model-name"), modelState: $("#model-state-label"), resourceStats: $("#resource-stats"), activityStats: $("#activity-stats"), lifeStats: $("#life-stats"), plannerStats: $("#planner-stats"),
  budgetStats: $("#budget-stats"), budgetMeter: $("#budget-meter"), budgetFill: $("#budget-meter-fill"), cooldown: $("#planner-cooldown"), plannerError: $("#planner-error"),
  buildingStats: $("#building-stats"),
};
const markers = new Map();
const expandedCommunications = new Set();
const expandedFamilies = new Set();
const communicationRenders = new Map();
let communicationTick = 0;
const rows = new Map();
const resources = new Map();
const buildingMarkers = new Map();
const activitySamples = new Map();
const popupTimers = new Set();
const popupActors = new Set();
let popupTick = -1;
let popupEventId = null;
let latestState = null;
let selectedId = null;
let mapMode = "overview";
let gridSize = "";
let pollFailures = 0;
let controlEpoch = 0;
let controlBusy = false;
let lastInspectorFamilyKey = "";
let citizenTooltip = null;
let citizenTooltipTarget = null;
const motionClock = createMotionClock();
let motionFrameAt = null;
let motionAnimationStarted = false;

function make(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function text(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return fallback; }
}
function count(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}
function safeColor(value) { return typeof value === "string" && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value.trim()) ? value.trim() : FALLBACK_COLOR; }
function clock(tick) {
  const seconds = count(tick);
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
}
function allCitizens(world = latestState?.world) {
  if (!world) return [];
  const living = Array.isArray(world.citizens) ? world.citizens : [];
  const archived = [world.dead, world.deadCitizens, world.tombstones, world.deceased, world.graveyard].flatMap((items) => Array.isArray(items) ? items : []);
  const result = [...living];
  const ids = new Set(living.map((citizen) => String(citizen?.id)));
  for (const citizen of archived) {
    if (citizen?.id === undefined || ids.has(String(citizen.id))) continue;
    ids.add(String(citizen.id));
    result.push({ ...citizen, alive: false, status: "dead" });
  }
  return result;
}
function alive(citizen) { return citizen?.alive !== false && citizen?.status !== "dead"; }
function citizenMonogram(name) {
  const trimmed = text(name).trim();
  return trimmed.match(/\s+(\d+)$/)?.[1] ?? (trimmed.charAt(0).toUpperCase() || "?");
}
function setAvatarLabel(avatar, person, name) {
  const label = alive(person) ? citizenMonogram(name) : "†";
  avatar.textContent = label;
  avatar.dataset.numbered = String(/^\d{2,}$/.test(label));
}
function nameOf(id) {
  const citizen = allCitizens().find((person) => String(person.id) === String(id));
  return citizen ? text(citizen.name, "Neighbor") : text(id, "Neighbor");
}
function activityDisplay(value) {
  return text(value).replace(/\breserves met\b/gi, "Choosing next undertaking");
}
function gatherPhrase(resource, target, camp, amount) {
  const label = `${resource === "food" ? "Forage" : "Gather"} ${text(resource, "supplies")}${amount ? ` ×${count(amount)}` : ""}`;
  if (camp === true) return `${label} · camping${target ? ` at ${text(target)}` : ""}`;
  return target ? `${label} · first preference ${text(target)}` : label;
}
function workPolicyLabel(work) {
  if (!work || typeof work !== "object") return "Choosing next undertaking";
  switch (work.type) {
    case "gather": return gatherPhrase(work.resource, work.target, work.camp);
    case "bake": {
      const ref = buildingRefLabel(work.target).trim();
      return `Bake bread${ref ? ` at ${ref}` : ""}`;
    }
    case "explore": return "Explore the map";
    case "guard": return `Guard ${buildingRefLabel(work.target).trim()}`.trim();
    case "rest": return "Rest for now";
    default: return text(work.type, "Choosing next undertaking");
  }
}
function actionLabel(action) {
  if (!action || typeof action !== "object") return "No active order";
  const target = action.nodeId ?? action.target;
  switch (action.type) {
    case "acquire": return `Collect ${text(action.resource, "supplies")} until ${count(action.quantity)} total${action.area ? ` in ${text(action.area).replaceAll("-", " ")}` : ""}`;
    case "gather": return gatherPhrase(action.resource, action.nodeId ?? action.target, action.camp, action.amount);
    case "build": {
      const kind = text(action.building ?? action.kind, "bakery").replace(/[\s_-]+/g, " ") || "bakery";
      const site = Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y)) ? ` at (${text(action.x)}, ${text(action.y)})` : action.nodeId ? ` near ${text(action.nodeId)}` : "";
      return `Build ${kind}${site}`;
    }
    case "construct": return `Construct wall blueprint ${text(action.plan)}`;
    case "bake": {
      const ref = buildingRefLabel(action.target ?? action.buildingId);
      return `Bake${action.amount ? ` ×${count(action.amount)}` : ""} bread${ref ? ` at ${ref}` : ""}`;
    }
    case "repair": {
      const ref = buildingRefLabel(action.target ?? action.buildingId).trim();
      return ref ? `Repair ${ref}` : "Repair building";
    }
    case "guard": return `Guard ${buildingRefLabel(action.target)}`;
    case "attackBuilding":
    case "destroy": return `Attack ${buildingRefLabel(action.target ?? action.buildingId)}`;
    case "explore": return "Explore the map";
    case "move": return `Move to (${action.x}, ${action.y})`;
    case "travel": return action.destination ? `Travel to (${action.destination.x}, ${action.destination.y})` : "Travel";
    case "harvest": return `Harvest ${text(target, "resource")}`;
    case "craft": return `Craft ${text(action.item, "item")} level ${count(action.level) || 1}`;
    case "post": return "Post to the public town board";
    case "message": return `Message ${nameOf(action.target ?? action.recipientId)}: ${concise(action.text, 48) || "…"}`;
    case "give": return `Give ${count(action.amount)} ${text(action.resource, "supplies")} to ${nameOf(action.target)}`;
    case "offer": return `Offer ${count(action.giveAmount)} ${text(action.give, "resource")}`;
    case "trade": return `Accept offer ${text(action.offer, "")}`;
    case "attack": {
      if (action.buildingId || /^(?:bakery|wall|house|building)/i.test(String(action.target))) return `Attack ${buildingRefLabel(action.buildingId ?? action.target)}`;
      return `Confront ${nameOf(action.target)}`;
    }
    case "propose_family": return `Propose a family with ${nameOf(action.target)}`;
    case "accept_family": return `Accept family proposal ${text(action.proposal)}`;
    case "decline_family": return `Decline family proposal ${text(action.proposal)}`;
    case "cancel_family": return `Cancel family proposal ${text(action.proposal)}`;
    case "reproduce": return `Meet accepted family partner ${nameOf(action.target)}`;
    case "rest": return action.target ? `Rest at ${action.target === "own" ? "own house" : text(action.target)}` : "Rest once";
    case "wait": return `Wait ${count(action.ticks)} ticks`;
    case "eat": return "Eat";
    case "sleep": return "Rest";
    default: return text(action.type, "Working");
  }
}
function activeOrder(citizen) { return citizen?.order?.task || (citizen?.order && typeof citizen.order === "object" ? citizen.order : null); }
function orderSummary(citizen) {
  const order = activeOrder(citizen);
  if (!order) return "No active order";
  const summary = actionLabel(order);
  if (order.type === "acquire") return `${summary} · ${count(citizen[order.resource])}/${count(order.quantity)} held`;
  if (order.type === "construct") return `${summary} · ${count(citizen.order?.progress)}/${citizen.constructionPlans?.[order.plan]?.tiles?.length ?? "?"} segments`;
  return ["gather", "bake"].includes(order.type) && citizen.order?.task
    ? `${summary} · ${count(citizen.order.progress)}${order.amount === undefined || order.amount === null ? " completed" : `/${count(order.amount)}`}`
    : summary;
}
function concise(value, limit = 76) {
  const normalized = text(value).replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}
function renderGoalChips(container, values, emptyLabel) {
  container.replaceChildren();
  const entries = Array.isArray(values) ? values.filter((value) => typeof value === "string" && value.trim()) : [];
  for (const value of entries.slice(0, 4)) {
    const chip = make("span", "goal-chip", concise(value, 72));
    chip.title = value;
    container.append(chip);
  }
  if (!entries.length) container.append(make("span", "goal-chip", emptyLabel));
}
function shortTick(tick) { return `T+${count(tick)}`; }
function setMode(mode) {
  clearActionPopups();
  mapMode = mode;
  ui.overviewMode.setAttribute("aria-pressed", String(mode === "overview"));
  ui.citizenMode.setAttribute("aria-pressed", String(mode === "citizen"));
  if (latestState?.world) renderMap(latestState.world);
}

function makeTileField(width, height) {
  const size = `${width}x${height}`;
  if (gridSize === size) return;
  gridSize = size;
  ui.tileField.replaceChildren();
  ui.tileField.style.gridTemplateColumns = `repeat(${width}, minmax(0, 1fr))`;
  ui.tileField.style.gridTemplateRows = `repeat(${height}, minmax(0, 1fr))`;
  for (let i = 0; i < width * height; i += 1) {
    const tile = make("span", "map-cell");
    tile.setAttribute("aria-hidden", "true");
    ui.tileField.append(tile);
  }
}
function nodeMemoryList(citizen) {
  const records = citizen?.knowledge?.nodes;
  if (Array.isArray(records)) return records;
  if (records && typeof records === "object") return Object.values(records);
  return [];
}
function exploredTiles(citizen) {
  const raw = citizen?.knowledge?.explored;
  const keys = new Set();
  if (Array.isArray(raw)) for (const item of raw) {
    if (typeof item === "string") keys.add(item);
    else if (item && Number.isInteger(item.x) && Number.isInteger(item.y)) keys.add(`${item.x},${item.y}`);
  }
  return keys;
}
function peopleMemoryList(citizen) {
  const records = citizen?.knowledge?.people;
  if (Array.isArray(records)) return records;
  if (records && typeof records === "object") return Object.values(records);
  return [];
}
function selectedCitizen() { return allCitizens().find((person) => String(person.id) === selectedId) || null; }
function mapPeople(world, citizenView, citizen) {
  if (!citizenView) return allCitizens(world);
  if (!citizen) return [];
  const id = String(citizen.id);
  const remembered = peopleMemoryList(citizen)
    .filter((person) => person && person.id !== undefined && String(person.id) !== id)
    .map((person) => ({ ...person, mapSource: "memory" }));
  return [citizen, ...remembered];
}
function personMemoryIsStale(person, tick) {
  const observed = person?.observedAt === null || person?.observedAt === undefined ? NaN : Number(person.observedAt);
  return person?.source === "report" || !Number.isFinite(observed) || observed < tick;
}
function visibleNodes(world) {
  if (mapMode === "overview") return (Array.isArray(world.nodes) ? world.nodes : []).map((node) => ({ ...node, source: "overview" }));
  return nodeMemoryList(selectedCitizen());
}
function nodeIsStale(node, tick) {
  if (node.source === "overview") return false;
  const observed = node.observedAt === null || node.observedAt === undefined ? NaN : Number(node.observedAt);
  return node.source === "report" || !Number.isFinite(observed) || observed < tick;
}
function worldBuildings(world = latestState?.world) { return Array.isArray(world?.buildings) ? world.buildings : []; }
function buildingMemoryList(citizen) {
  const records = citizen?.knowledge?.buildings;
  if (Array.isArray(records)) return records;
  if (records && typeof records === "object") return Object.values(records);
  return [];
}
function buildingKindLabel(building) {
  const kind = text(building?.kind, "building").replace(/[_-]+/g, " ").trim() || "building";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
function buildingObservedAtLabel(building) {
  const observed = building?.observedAt === null || building?.observedAt === undefined ? NaN : Number(building.observedAt);
  return Number.isFinite(observed) ? `Last seen ${shortTick(observed)}` : "Observation age unknown";
}
function buildingIsStale(building, tick = count(latestState?.world?.tick)) {
  if (building?.source === "overview") return false;
  const observed = building?.observedAt === null || building?.observedAt === undefined ? NaN : Number(building.observedAt);
  return building?.source === "report" || !Number.isFinite(observed) || observed < tick;
}
function buildingOwnerLabel(building) {
  if (building?.ownerId === null && building?.ruin) return "unclaimed ruin";
  return building?.ownerId === undefined || building?.ownerId === null || building?.ownerId === ""
    ? "unknown owner" : nameOf(building.ownerId);
}
function buildingConditionLabel(building) {
  const health = count(building?.health);
  const maxHealth = Math.max(health, count(building?.maxHealth));
  return building?.destroyed === true || (maxHealth > 0 && health <= 0)
    ? "ruin"
    : maxHealth ? `condition ${health} of ${maxHealth}` : "condition unknown";
}
function buildingRefLabel(id) {
  if (id === undefined || id === null || String(id) === "") return "";
  if (String(id) === "own") return "own bakery";
  const kind = /^bakery/i.test(String(id)) ? "bakery" : /^wall/i.test(String(id)) ? "wall" : /^house/i.test(String(id)) ? "house" : "building";
  return `the ${kind} ${text(id)}`;
}
function shareInfoLines(share, citizen) {
  if (!Array.isArray(share) || !share.length) return [];
  const buildings = buildingMemoryList(citizen);
  const isBuilding = (id) => buildings.some((building) => building?.id !== undefined && String(building.id) === String(id))
    || /^bakery/i.test(String(id));
  const deposits = [];
  const sharedBuildings = [];
  for (const id of share) {
    if (isBuilding(id)) sharedBuildings.push(text(id));
    else deposits.push(text(id));
  }
  const lines = [];
  if (deposits.length) lines.push(`Shared deposits: ${deposits.join(", ")}`);
  if (sharedBuildings.length) lines.push(`Shared buildings: ${sharedBuildings.join(", ")}`);
  return lines;
}
// Explicit post/message `shareBuildings` field: sender already asserted these are
// building IDs, so render them verbatim (no deposit classification, no live HP reads).
function sharedBuildingsLine(shareBuildings) {
  if (!Array.isArray(shareBuildings) || !shareBuildings.length) return null;
  const ids = shareBuildings.map((id) => text(id)).filter(Boolean);
  if (!ids.length) return null;
  return `Shared buildings: ${ids.join(", ")}`;
}
function updateResourceMarkers(world, width, height) {
  const tick = count(world.tick);
  const nodeList = visibleNodes(world);
  const shown = new Set();
  for (const node of nodeList) {
    if (!node || node.id === undefined || !Number.isFinite(Number(node.x)) || !Number.isFinite(Number(node.y))) continue;
    const id = String(node.id);
    shown.add(id);
    let record = resources.get(id);
    if (!record) {
      const marker = make("div", "resource-node");
      const symbol = make("span", "resource-symbol");
      symbol.setAttribute("aria-hidden", "true");
      const level = make("span", "resource-level");
      level.setAttribute("aria-hidden", "true");
      const ring = svgElement("svg", { viewBox: "0 0 30 30", class: "resource-ring", "aria-hidden": "true" });
      const track = svgElement("circle", { cx: 15, cy: 15, r: 13, class: "resource-ring-track" });
      const progress = svgElement("circle", { cx: 15, cy: 15, r: 13, pathLength: 100, "stroke-dasharray": 100, transform: "rotate(-90 15 15)", class: "resource-ring-progress" });
      ring.append(track, progress);
      marker.append(symbol, ring, level);
      ui.resourceLayer.append(marker);
      record = { marker, symbol, ring, progress, level };
      resources.set(id, record);
    }
    const x = Math.max(0, Math.min(width - 1, count(node.x)));
    const y = Math.max(0, Math.min(height - 1, count(node.y)));
    const tree = node.kind === "tree" || node.kind === "wood";
    const stock = count(node.stock);
    const depleted = stock === 0;
    // Exact countdowns belong only to spectator data, never remembered observations.
    const timed = depleted && node.source === "overview" && Number.isFinite(node.regrowIn) && count(node.regrowTicks) > 0;
    const remaining = count(node.regrowIn);
    const refill = timed ? Math.max(0, Math.min(1, 1 - remaining / count(node.regrowTicks))) : 0;
    const stale = nodeIsStale(node, tick);
    const observedAt = node.observedAt !== null && node.observedAt !== undefined && Number.isFinite(Number(node.observedAt)) ? `Last seen ${shortTick(node.observedAt)}` : "Observation age unknown";
    const source = node.source === "report" ? `Reported by ${nameOf(node.reportedBy)}` : node.source === "overview" ? "Spectator overview" : observedAt;
    const condition = node.source === "overview" ? depleted ? "Regenerating" : "Harvestable" : depleted ? "Last seen depleted" : "Last seen harvestable";
    const label = `${tree ? "Tree" : "Food"} deposit ${id}${node.level ? ` · level ${node.level}` : ""}: ${condition}${timed ? ` · ${remaining} ticks remaining` : ""}, yields ${count(node.yield ?? (tree ? 5 : 1))} ${tree ? "wood" : "food"} per harvest. ${source}${stale ? ". Stale information." : ""}`;
    record.marker.className = `resource-node ${tree ? "tree" : "crop"}${depleted ? " is-depleted" : ""}${stale ? " is-stale" : ""}`;
    record.marker.dataset.level = node.level ?? "";
    record.level.textContent = node.level ? `L${node.level}` : "";
    record.level.hidden = !node.level;
    record.marker.setAttribute("role", "img");
    record.marker.setAttribute("aria-label", label);
    record.marker.title = label;
    record.marker.style.left = `${((x + .5) / width) * 100}%`;
    record.marker.style.top = `${((y + .5) / height) * 100}%`;
    record.symbol.textContent = tree ? "♣" : "✳";
    record.ring.style.display = timed ? "" : "none";
    record.progress.setAttribute("stroke-dashoffset", String((1 - refill) * 100));
  }
  for (const [id, record] of resources) if (!shown.has(id)) { record.marker.remove(); resources.delete(id); }
}
function updateBuildingMarkers(world, citizenView, citizen, width, height) {
  const tick = count(world.tick);
  // Spectator view reads actual world buildings; citizen view reads only personal remembered snapshots.
  const list = citizenView
    ? buildingMemoryList(citizen)
    : worldBuildings(world).map((building) => ({ ...building, source: "overview" }));
  const shown = new Set();
  for (const building of list) {
    if (!building || building.id === undefined || !Number.isFinite(Number(building.x)) || !Number.isFinite(Number(building.y))) continue;
    const id = String(building.id);
    shown.add(id);
    let record = buildingMarkers.get(id);
    if (!record) {
      const marker = make("div", "building-node");
      const symbol = make("span", "building-symbol");
      symbol.setAttribute("aria-hidden", "true");
      const bar = make("span", "building-health");
      const fill = make("span", "building-health-fill");
      bar.append(fill);
      marker.append(symbol, bar);
      marker.setAttribute("role", "img");
      ui.buildingLayer.append(marker);
      record = { marker, symbol, fill };
      buildingMarkers.set(id, record);
    }
    const remembered = citizenView;
    const stale = remembered && buildingIsStale(building, tick);
    const health = count(building.health);
    const maxHealth = Math.max(health, count(building.maxHealth));
    const destroyed = building.destroyed === true || (maxHealth > 0 && health <= 0);
    const kindLabel = buildingKindLabel(building);
    const owner = buildingOwnerLabel(building);
    const mine = citizen && building.ownerId !== undefined && String(building.ownerId) === String(citizen.id);
    const condition = buildingConditionLabel(building);
    const source = remembered
      ? building.source === "report" ? `Reported by ${nameOf(building.reportedBy)}` : buildingObservedAtLabel(building)
      : "Spectator overview · actual building";
    const label = remembered
      ? `Remembered ${kindLabel.toLowerCase()} ${id}: owner ${owner}, ${condition} as last seen. ${source}${stale ? ". Stale information." : ""}`
      : `${kindLabel} ${id}: owned by ${owner}, ${condition}. ${source}`;
    const ratio = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
    record.marker.className = `building-node${building.kind === "wall" ? " is-wall" : ""}${destroyed ? " is-ruin" : ""}${stale ? " is-stale" : ""}${remembered ? " is-remembered" : ""}${mine ? " is-mine" : ""}${!destroyed && ratio <= .34 ? " is-low" : ""}`;
    record.marker.style.left = `${((Math.max(0, Math.min(width - 1, count(building.x))) + .5) / width) * 100}%`;
    record.marker.style.top = `${((Math.max(0, Math.min(height - 1, count(building.y))) + .5) / height) * 100}%`;
    record.marker.title = label;
    record.marker.setAttribute("aria-label", label);
    record.symbol.textContent = building.kind === "wall" ? "▥" : building.kind === "house" ? "▵" : "⌂";
    record.fill.style.width = `${destroyed ? 0 : Math.round(ratio * 100)}%`;
  }
  for (const [id, record] of buildingMarkers) if (!shown.has(id)) { record.marker.remove(); buildingMarkers.delete(id); }
}
function makeMarker(id) {
  const button = make("button", "citizen-marker");
  button.type = "button";
  button.dataset.id = id;
  button.setAttribute("aria-describedby", "citizen-tooltip");
  const avatar = make("span", "citizen-avatar");
  avatar.setAttribute("aria-hidden", "true");
  const label = make("span", "marker-name");
  button.append(avatar, label);
  button.addEventListener("click", () => selectCitizen(button.dataset.id));
  button.addEventListener("pointerenter", () => showCitizenTooltip(button));
  button.addEventListener("pointermove", positionCitizenTooltip);
  button.addEventListener("pointerleave", () => { if (document.activeElement !== button) hideCitizenTooltip(); });
  button.addEventListener("focus", () => showCitizenTooltip(button));
  button.addEventListener("blur", () => { if (!button.matches(":hover")) hideCitizenTooltip(); });
  ui.citizenLayer.append(button);
  return { button, avatar, label, person: null };
}
function tooltipText(citizen) {
  if (citizen.mapSource === "memory") {
    const observed = citizen.observedAt === null || citizen.observedAt === undefined ? NaN : Number(citizen.observedAt);
    const lastSeen = Number.isFinite(observed) ? `Last seen ${shortTick(observed)}` : "Last-seen time unknown";
    const reporter = citizen.source === "report" ? `Reported by ${nameOf(citizen.reportedBy)}` : "Seen by this citizen";
    return `${text(citizen.name, "Citizen")}\nRemembered location: (${count(citizen.x)}, ${count(citizen.y)})\n${reporter} · ${lastSeen}${personMemoryIsStale(citizen, count(latestState?.world?.tick)) ? " · stale" : ""}`;
  }
  const activity = concise(activityDisplay(citizen.activity) || "Not reported", 76);
  const lines = [text(citizen.name, "Citizen"), alive(citizen) ? activity : "Deceased"];
  if (citizen.planning === true) lines.push("Planning");
  const order = activeOrder(citizen);
  lines.push(`Order: ${concise(order ? orderSummary(citizen) : "None", 76)}`);
  return lines.join("\n");
}
function positionCitizenTooltip() {
  if (!citizenTooltip || citizenTooltip.hidden || !citizenTooltipTarget?.isConnected) return;
  const anchor = citizenTooltipTarget.getBoundingClientRect();
  const bounds = citizenTooltip.getBoundingClientRect();
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - bounds.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - bounds.height - margin);
  const left = Math.max(margin, Math.min(anchor.left + anchor.width / 2 - bounds.width / 2, maxLeft));
  const name = citizenTooltipTarget.querySelector(".marker-name").getBoundingClientRect();
  const above = Math.min(anchor.top, name.top) - bounds.height - margin;
  const below = Math.max(anchor.bottom, name.bottom) + margin;
  const top = Math.max(margin, Math.min(above >= margin ? above : below, maxTop));
  citizenTooltip.style.left = `${Math.round(left)}px`;
  citizenTooltip.style.top = `${Math.round(top)}px`;
}
function showCitizenTooltip(button) {
  const citizen = markers.get(button.dataset.id)?.person;
  if (!citizen) return;
  if (!citizenTooltip) {
    citizenTooltip = make("div", "citizen-tooltip");
    citizenTooltip.id = "citizen-tooltip";
    citizenTooltip.setAttribute("role", "tooltip");
    citizenTooltip.hidden = true;
    document.body.append(citizenTooltip);
  }
  citizenTooltipTarget = button;
  citizenTooltip.textContent = tooltipText(citizen);
  citizenTooltip.hidden = false;
  positionCitizenTooltip();
}
function hideCitizenTooltip() {
  if (citizenTooltip) citizenTooltip.hidden = true;
  citizenTooltipTarget = null;
}
function markerOffsets(people, width, height) {
  const groups = new Map();
  for (const person of people) {
    const x = Math.max(0, Math.min(width - 1, count(person.x)));
    const y = Math.max(0, Math.min(height - 1, count(person.y)));
    const key = `${x},${y}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(person);
  }
  const offsets = new Map();
  for (const members of groups.values()) {
    members.sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
    // Keep shared-tile tokens inside their tile neighbourhood, not scattered across nearby tiles.
    const radius = members.length > 1 ? Math.min(9, 4 + members.length) : 0;
    members.forEach((person, index) => {
      const angle = index * (2 * Math.PI / members.length);
      offsets.set(String(person.id), {
        count: members.length,
        x: members.length > 1 ? Math.round(Math.cos(angle) * radius) : 0,
        y: members.length > 1 ? Math.round(Math.sin(angle) * radius) : 0,
      });
    });
  }
  return offsets;
}
function makeRow(id) {
  const button = make("button", "citizen-row");
  button.type = "button";
  button.dataset.id = id;
  const avatar = make("span", "row-avatar");
  avatar.setAttribute("aria-hidden", "true");
  const copy = make("span", "row-copy");
  const name = make("span", "row-name");
  const activity = make("span", "row-activity");
  copy.append(name, activity);
  button.append(avatar, copy);
  button.addEventListener("click", () => selectCitizen(button.dataset.id));
  ui.citizenList.append(button);
  return { button, avatar, name, activity };
}
function svgElement(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
function positionMarker(record, point, elapsedMs = null) {
  const { width, height, stack } = record.draw;
  if (!record.offset || elapsedMs === null) record.offset = { x: stack.x, y: stack.y };
  else {
    const weight = 1 - Math.exp(-Math.max(0, elapsedMs) / 100);
    record.offset.x += (stack.x - record.offset.x) * weight;
    record.offset.y += (stack.y - record.offset.y) * weight;
  }
  record.button.style.left = `clamp(16px, calc(${((point.x + .5) / width) * 100}% + ${record.offset.x}px), calc(100% - 16px))`;
  record.button.style.top = `clamp(16px, calc(${((point.y + .5) / height) * 100}% + ${record.offset.y}px), calc(100% - 16px))`;
}
function animateMotion(now) {
  const state = latestState;
  const frameMs = motionFrameAt === null ? 0 : now - motionFrameAt;
  motionFrameAt = now;
  if (state?.world) {
    const tick = motionClock.sample(now);
    for (const record of markers.values()) if (record.draw?.animated) {
      positionMarker(record, sampleMotion(record.person.motion, tick, record.draw), frameMs);
    }
    if (citizenTooltipTarget) positionCitizenTooltip();
  }
  window.requestAnimationFrame(animateMotion);
}
function renderMap(world) {
  const width = Math.max(1, count(world.width) || 16);
  const height = Math.max(1, count(world.height) || 10);
  ui.mapBoard.style.aspectRatio = `${width} / ${height}`;
  ui.mapBoard.style.width = `min(100%, ${100 * width / height}cqh)`;
  makeTileField(width, height);
  const citizen = selectedCitizen();
  const explored = exploredTiles(citizen);
  const visible = new Set(citizen?.visibleTiles ?? []);
  const citizenView = mapMode === "citizen";
  const cells = ui.tileField.children;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    cells[y * width + x].classList.toggle("is-fogged", citizenView && !explored.has(`${x},${y}`));
    cells[y * width + x].classList.toggle("is-out-of-sight", citizenView && Array.isArray(citizen?.visibleTiles) && explored.has(`${x},${y}`) && !visible.has(`${x},${y}`));
  }
  ui.mapBoard.setAttribute("aria-label", `${citizenView ? `${citizen ? `${text(citizen.name)}’s` : "Citizen"} knowledge view` : "Spectator overview"} map, ${width} columns by ${height} rows`);
  ui.viewNote.textContent = citizenView
    ? citizen ? `${text(citizen.name)}’s knowledge · remembered people, deposits and buildings may be stale` : "Select a citizen to show their remembered map"
    : "Spectator overview · world data, not a citizen’s knowledge";
  ui.mapHint.textContent = citizenView ? `${explored.size} explored tiles · select a person to inspect` : "Hover for names · click to inspect";
  updateResourceMarkers(world, width, height);
  updateBuildingMarkers(world, citizenView, citizen, width, height);

  const directoryPeople = allCitizens(world);
  const people = mapPeople(world, citizenView, citizen).filter((person) =>
    person.id !== undefined && Number.isFinite(Number(person.x)) && Number.isFinite(Number(person.y)));
  const stacks = markerOffsets(people, width, height);
  const present = new Set();
  for (const person of people) {
    const id = String(person.id);
    present.add(id);
    let record = markers.get(id);
    if (!record) { record = makeMarker(id); markers.set(id, record); }
    record.person = person;
    const x = Math.max(0, Math.min(width - 1, count(person.x)));
    const y = Math.max(0, Math.min(height - 1, count(person.y)));
    const stack = stacks.get(id) || { count: 1, x: 0, y: 0 };
    const coLocated = stack.count > 1;
    const remembered = person.mapSource === "memory";
    const stale = remembered && personMemoryIsStale(person, count(world.tick));
    record.button.className = `citizen-marker${coLocated ? " is-co-located" : ""}${popupActors.has(id) ? " has-popup" : ""}${y === 0 ? " is-near-top" : ""}${id === selectedId ? " is-selected" : ""}${person.adult === false ? " is-child" : ""}${!alive(person) ? " is-dead" : ""}${person.planning === true ? " is-planning" : ""}${person.status === "error" ? " is-error" : ""}${remembered ? " is-remembered" : ""}${stale ? " is-stale" : ""}`;
    record.draw = { x, y, width, height, stack, animated: !remembered && alive(person) && Array.isArray(person.motion)
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && typeof window.requestAnimationFrame === 'function' };
    record.button.classList.toggle('is-interpolated', record.draw.animated);
    if (!record.draw.animated) positionMarker(record, record.draw);
    record.button.style.setProperty("--label-shift", x === 0 ? "34px" : x === width - 1 ? "-34px" : "0px");
    record.button.style.setProperty("--citizen-color", safeColor(person.color));
    const name = text(person.name, "Citizen");
    setAvatarLabel(record.avatar, person, name);
    record.label.textContent = name;
    record.button.setAttribute("aria-pressed", String(id === selectedId));
    const description = remembered
      ? `remembered location (${x}, ${y})${stale ? ", stale" : ""}`
      : alive(person) ? activityDisplay(text(person.activity, person.planning ? "Planning" : "Choosing next undertaking")) : "deceased, last known location";
    record.button.setAttribute("aria-label", `${name}, ${description}. Select to inspect.`);
    if (citizenTooltipTarget === record.button) showCitizenTooltip(record.button);
  }
  for (const [id, record] of markers) if (!present.has(id)) { if (citizenTooltipTarget === record.button) hideCitizenTooltip(); record.button.remove(); markers.delete(id); }
  if (!motionAnimationStarted && typeof window.requestAnimationFrame === 'function') {
    motionAnimationStarted = true; window.requestAnimationFrame(animateMotion);
  }

  const directoryIds = new Set();
  for (const person of directoryPeople) {
    if (person.id === undefined) continue;
    const id = String(person.id);
    directoryIds.add(id);
    let row = rows.get(id);
    if (!row) { row = makeRow(id); rows.set(id, row); }
    const name = text(person.name, "Citizen");
    row.button.className = `citizen-row${id === selectedId ? " is-selected" : ""}${!alive(person) ? " is-dead" : ""}`;
    row.button.style.setProperty("--citizen-color", safeColor(person.color));
    setAvatarLabel(row.avatar, person, name);
    row.name.textContent = name;
    row.activity.textContent = citizenView ? "Spectator directory" : alive(person) ? activityDisplay(text(person.activity, person.planning ? "Planning" : "Choosing next undertaking")) : "Deceased";
    row.button.setAttribute("aria-pressed", String(id === selectedId));
    row.button.setAttribute("aria-label", `${name}: ${row.activity.textContent}. Select to inspect.`);
  }
  for (const [id, record] of rows) if (!directoryIds.has(id)) { record.button.remove(); rows.delete(id); }

  ui.overlay.replaceChildren();
  ui.overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
  ui.overlay.setAttribute("preserveAspectRatio", "none");
  if (world.rings?.length) {
    if (world.center) ui.overlay.append(svgElement("rect", { x: world.center.x, y: world.center.y,
      width: world.center.width, height: world.center.height, class: "area-center" }));
    for (const rect of [...(world.center ? [world.center] : []), ...world.rings.slice(0, -1)])
      ui.overlay.append(svgElement("rect", { x: rect.x, y: rect.y, width: rect.width, height: rect.height, class: "area-boundary" }));
    const compassLines = world.center
      ? `M ${width / 2} 0 V ${world.center.y} M ${width / 2} ${world.center.y + world.center.height} V ${height} M 0 ${height / 2} H ${world.center.x} M ${world.center.x + world.center.width} ${height / 2} H ${width}`
      : `M ${width / 2} 0 V ${height} M 0 ${height / 2} H ${width}`;
    ui.overlay.append(svgElement("path", { d: compassLines, class: "area-boundary" }));
    if (world.center) {
      const label = svgElement("text", { x: world.center.x + 1.6, y: world.center.y + .65, class: "area-label center-label" });
      label.textContent = "Center · L3";
      ui.overlay.append(label);
    }
    for (const [compass, east, south] of [["NW", false, false], ["NE", true, false], ["SW", false, true], ["SE", true, true]]) {
      for (const ring of world.rings) {
        const label = svgElement("text", { x: ring.x + ring.width * (east ? .75 : .25),
          y: south ? ring.y + ring.height - .35 : ring.y + .65, class: "area-label" });
        label.textContent = `${compass} · R${ring.ring}${world.center ? ` · L${3 - ring.ring}` : ""}`;
        ui.overlay.append(label);
      }
    }
  }
  for (const cell of Array.isArray(world.blocked) ? world.blocked : []) {
    const x = Number(cell?.x), y = Number(cell?.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) continue;
    const ridge = svgElement("rect", { x, y, width: 1, height: 1, class: "blocked-cell" });
    const title = svgElement("title"); title.textContent = "Blocked ridge"; ridge.append(title); ui.overlay.append(ridge);
  }
  if (!citizenView && citizen && alive(citizen)) {
    const path = Array.isArray(citizen.path) ? citizen.path : [];
    const points = [{ x: Number(citizen.x), y: Number(citizen.y) }];
    for (const point of path) {
      const x = Number(Array.isArray(point) ? point[0] : point?.x);
      const y = Number(Array.isArray(point) ? point[1] : point?.y);
      if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < width && y < height) points.push({ x, y });
    }
    if (points.length > 1) {
      ui.overlay.append(svgElement("polyline", { points: points.map(({ x, y }) => `${x + .5},${y + .5}`).join(" "), class: "selected-route" }));
      ui.overlay.append(svgElement("circle", { cx: points[0].x + .5, cy: points[0].y + .5, r: .19, class: "route-origin" }));
      const end = points.at(-1);
      ui.overlay.append(svgElement("circle", { cx: end.x + .5, cy: end.y + .5, r: .16, class: "route-destination" }));
    }
  }
}
function selectCitizen(id) {
  if (!allCitizens().some((person) => String(person.id) === String(id))) return;
  selectedId = String(id);
  lastInspectorFamilyKey = "";
  if (latestState?.world) renderState(latestState);
}

function need(label, value, kind = "") {
  const known = value !== null && value !== undefined && Number.isFinite(Number(value));
  const amount = Math.min(100, count(value));
  const root = make("div", "need");
  const labelRow = make("div", "need-label");
  labelRow.append(make("span", "", label), make("b", "", known ? `${amount}` : "—"));
  const bar = make("div", "meter");
  bar.setAttribute("role", "meter"); bar.setAttribute("aria-label", label); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", known ? String(amount) : "0");
  const fill = make("div", `meter-fill${kind ? ` ${kind}` : ""}`); fill.style.width = known ? `${amount}%` : "0%"; bar.append(fill); root.append(labelRow, bar);
  return root;
}
function familyLink(id) {
  const button = make("button", "person-link", nameOf(id));
  button.type = "button";
  button.addEventListener("click", () => selectCitizen(String(id)));
  return button;
}
function setFamilyLinks(container, citizen, people) {
  const parents = Array.isArray(citizen.parents) ? citizen.parents : [];
  const children = people.filter((person) => Array.isArray(person.parents) && person.parents.some((id) => String(id) === String(citizen.id)));
  const key = `${citizen.id}|${parents.map(String).join(",")}|${children.map((person) => `${person.id}:${alive(person)}`).join(",")}`;
  if (container.dataset.familyKey === key) return;
  container.dataset.familyKey = key;
  container.replaceChildren();
  const addGroup = (label, ids) => {
    if (!ids.length) return;
    if (container.childNodes.length) container.append(make("span", "", "·"));
    container.append(make("strong", "", `${label}:`));
    ids.forEach((id, index) => {
      if (index) container.append(make("span", "", ","));
      container.append(familyLink(id));
    });
  };
  addGroup("Parents", parents);
  if (children.length) {
    const details = make("details", "family-children");
    const living = children.filter(alive).length;
    details.open = expandedFamilies.has(String(citizen.id));
    details.append(make("summary", "", `${children.length} children · ${living} living${living < children.length ? `, ${children.length - living} deceased` : ""}`));
    const links = make("div", "family-child-links");
    for (const child of children) {
      const link = familyLink(child.id);
      if (!alive(child)) { link.textContent += " †"; link.setAttribute("aria-label", `${text(child.name)} (deceased)`); }
      links.append(link);
    }
    details.append(links);
    details.addEventListener("toggle", () => details.open ? expandedFamilies.add(String(citizen.id)) : expandedFamilies.delete(String(citizen.id)));
    container.append(details);
  }
  if (!container.childNodes.length) container.append(make("span", "", "No family links reported"));
}
function detailBlock(title, content, className = "") {
  const section = make("section", `detail-block${className ? ` ${className}` : ""}`);
  section.append(make("h3", "", title), content);
  return section;
}
function latestPrivateMessages(messages, citizenId, field) {
  return messages.map((message, index) => ({ message, index }))
    .filter(({ message }) => message && String(message[field]) === String(citizenId))
    .sort((a, b) => {
      const aTick = Number(a.message.tick), bTick = Number(b.message.tick);
      const aOrder = Number.isFinite(aTick) ? aTick : -Infinity;
      const bOrder = Number.isFinite(bTick) ? bTick : -Infinity;
      return bOrder - aOrder || b.index - a.index;
    })
    .slice(0, 4)
    .map(({ message }) => message);
}
function renderPrivateMessages(details, citizen, world) {
  const content = details.querySelector(".private-message-content");
  content.replaceChildren();
  const messages = Array.isArray(world?.messages) ? world.messages : [];
  const inbox = latestPrivateMessages(messages, citizen.id, "recipientId");
  const outbox = latestPrivateMessages(messages, citizen.id, "senderId");
  if (!inbox.length && !outbox.length) {
    content.append(make("p", "empty-copy", "No private messages."));
    return;
  }
  const addGroup = (label, entries, emptyLabel) => {
    const group = make("section", "private-message-group");
    group.append(make("h4", "", label));
    if (!entries.length) group.append(make("p", "empty-copy", emptyLabel));
    for (const message of entries) {
      const entry = make("article", "private-message-entry");
      const sender = nameOf(message.senderId);
      const recipient = nameOf(message.recipientId);
      entry.append(make("p", "private-message-meta", `From ${sender} · To ${recipient} · ${shortTick(message.tick)}`));
      entry.append(make("p", "private-message-text", concise(message.text, 120) || "(No text)"));
      for (const line of shareInfoLines(message.share, citizen)) entry.append(make("p", "private-message-share", line));
      const sharedBuildings = sharedBuildingsLine(message.shareBuildings);
      if (sharedBuildings) entry.append(make("p", "private-message-share", sharedBuildings));
      const location = message.location;
      if (location && location.x !== null && location.x !== undefined && location.y !== null && location.y !== undefined && Number.isFinite(Number(location.x)) && Number.isFinite(Number(location.y))) {
        entry.append(make("p", "private-message-share", `Location shared: (${text(location.x)}, ${text(location.y)})`));
      }
      group.append(entry);
    }
    content.append(group);
  };
  addGroup("Inbox · latest 4", inbox, "No incoming messages.");
  addGroup("Outbox · latest 4", outbox, "No outgoing messages.");
}
function renderInspector(citizen) {
  if (!citizen) {
    ui.inspectorTitle.textContent = "Select a citizen";
    ui.planningChip.hidden = true;
    ui.inspectorContent.replaceChildren(make("p", "empty-copy", "Citizen details will appear here."));
    return;
  }
  const people = allCitizens();
  const name = text(citizen.name, "Citizen");
  ui.inspectorTitle.textContent = name;
  ui.planningChip.hidden = citizen.planning !== true;
  ui.planningChip.textContent = "Planning";
  const root = ui.inspectorContent;
  let identity = root.querySelector(".inspector-identity");
  if (!identity) {
    root.replaceChildren();
    root.append(make("p", "observer-note", "Spectator inspector · full world data, not citizen knowledge."));
    identity = make("div", "inspector-identity");
    const avatar = make("span", "inspector-avatar");
    avatar.setAttribute("aria-hidden", "true");
    const meta = make("div", "inspector-meta");
    identity.append(avatar, meta);
    root.append(identity);
    const needs = make("div", "needs");
    needs.append(need("Health", citizen.health, "health"), need("Hunger", citizen.hunger, "hunger"), need("Energy", citizen.energy));
    root.append(needs);
    root.append(make("p", "inventory-line"));
    root.append(make("div", "family-line"));
    const activity = make("section", "activity-box");
    activity.append(make("p", "activity-label", "Current activity"), make("p", "activity-text"), make("span", "retained-badge", "Previous plan retained"));
    root.append(activity);
    const policyContent = make("div", "policy-copy");
    policyContent.append(make("p", "detail-copy work-policy-copy"), make("p", "knowledge-source work-policy-review"), make("div", "family-proposal-list"));
    root.append(detailBlock("Work policy", policyContent, "work-detail"));
    root.append(detailBlock("Long-lived order", make("p", "detail-copy", "No order"), "order-detail"));
    root.append(detailBlock("Property alerts", make("div", "property-alert-list"), "property-alert-detail"));
    root.append(detailBlock("Up next", make("ol", "next-list"), "next-detail"));
    root.append(detailBlock("Character", make("p", "detail-copy"), "character-detail"));
    root.append(detailBlock("Durable aspirations", make("div", "goal-list"), "aspirations-detail"));
    root.append(detailBlock("Current goals", make("div", "goal-list"), "goals-detail"));
    root.append(detailBlock("Current undertaking", make("p", ""), "undertaking-detail"));
    root.append(detailBlock("Since last decision", make("p", "detail-copy"), "strategy-progress-detail"));
    root.append(detailBlock("Own buildings", make("div", "building-list"), "buildings-detail"));
    const privateMessages = make("details", "inspector-details private-messages");
    privateMessages.append(make("summary", "", "Private messages"), make("div", "private-message-content"));
    root.append(privateMessages);
    const details = make("details", "inspector-details");
    details.append(make("summary", "", "Knowledge, memories & diagnostics"));
    const inside = make("div", "detail-extra knowledge-extra");
    inside.append(make("h3", "", "Known deposits"), make("div", "resource-knowledge"));
    details.append(inside);
    const memories = make("div", "detail-extra memories-extra");
    memories.append(make("h3", "", "Memories & thought"), make("p", ""));
    details.append(memories);
    const history = make("div", "detail-extra history-extra");
    history.append(make("h3", "", "Resource visit record"), make("p", ""));
    details.append(history);
    const error = make("div", "detail-extra citizen-error");
    error.append(make("h3", "", "Planner error"), make("p", ""));
    details.append(error);
    root.append(details);
  }
  const avatar = root.querySelector(".inspector-avatar");
  avatar.style.setProperty("--citizen-color", safeColor(citizen.color));
  setAvatarLabel(avatar, citizen, name);
  const age = citizen.bornAt === null || citizen.bornAt === undefined ? "" : ` · ${count(latestState?.world?.tick) - count(citizen.bornAt)} ticks old`;
  const metaNode = root.querySelector(".inspector-meta");
  metaNode.replaceChildren(make("strong", "", name), document.createTextNode(` · ${alive(citizen) ? citizen.adult === false ? "Child" : "Adult" : "Deceased"}${age} · (${count(citizen.x)}, ${count(citizen.y)})`));

  const needs = root.querySelector(".needs");
  const propertyAlerts = root.querySelector(".property-alert-list");
  propertyAlerts.replaceChildren();
  for (const alert of (citizen.buildingAlerts ?? []).slice(-3).reverse()) {
    propertyAlerts.append(make("p", "detail-copy", `${shortTick(alert.tick)} · ${text(alert.attackerName, nameOf(alert.attackerId))} attacked ${text(alert.targetId)} · ${alert.destroyed ? "destroyed" : `${count(alert.health)} health remaining`}`));
  }
  root.querySelector(".property-alert-detail").hidden = !propertyAlerts.childNodes.length;
  needs.replaceChildren(need("Health", citizen.health, "health"), need("Hunger", citizen.hunger, "hunger"), need("Energy", citizen.energy));
  const items = [`${count(citizen.food)} raw food`];
  if (citizen.bread !== undefined) items.unshift(`${count(citizen.bread)} bread`);
  items.push(`${count(citizen.wood)} wood`);
  if (citizen.tool) items.push(`tool level ${count(citizen.toolLevel) || 1}`);
  if (citizen.weapon) items.push(`weapon level ${count(citizen.weaponLevel) || 1}${citizen.weaponDurability === undefined ? "" : ` · ${count(citizen.weaponDurability)} durability`}`);
  if (citizen.shoes === true) items.push(`shoes level ${count(citizen.shoesLevel) || 1} · ${[1, 1.1, 1.4, 1.8][count(citizen.shoesLevel) || 1]}× travel`);
  else if (citizen.shoes === false) items.push("no shoes · 1× travel");
  if (citizen.health === undefined) items.push("health not reported");
  const inventory = root.querySelector(".inventory-line");
  inventory.replaceChildren(make("strong", "", items.join(" · ")), make("span", "inventory-note", `Raw food restores 35 hunger · bread ${BREAD_NUTRITION}.`));
  const family = root.querySelector(".family-line");
  setFamilyLinks(family, citizen, people);
  const activityFallback = citizen.planning === true ? "Planning"
    : alive(citizen) ? (citizen.work !== undefined ? workPolicyLabel(citizen.work) : "Activity not reported") : "Deceased";
  const activityText = activityDisplay(text(citizen.activity, activityFallback));
  const current = citizen.current;
  const remaining = Number(current?.remaining);
  const routineIdle = current?.task?.type === "wait" && current?.purpose === "routine";
  const workTime = !routineIdle && current?.task?.type !== "move" && Number.isFinite(remaining) && remaining > 0 ? ` · ${Math.ceil(remaining)} ticks remaining` : "";
  root.querySelector(".activity-text").textContent = `${activityText}${workTime}`;
  const workPolicyCopy = root.querySelector(".work-policy-copy");
  const workPolicyReview = root.querySelector(".work-policy-review");
  const familyProposals = root.querySelector(".family-proposal-list");
  workPolicyCopy.textContent = citizen.work !== undefined ? workPolicyLabel(citizen.work) : "Work policy not reported";
  if (citizen.planning === true) workPolicyCopy.textContent += " · Reviewing strategy";
  const reviewTick = Number(citizen.reviewAt);
  const worldTick = Number(latestState?.world?.tick);
  const schedule = latestState?.planner?.citizens?.find(c => c.id === citizen.id);
  workPolicyReview.textContent = !alive(citizen) || !Number.isFinite(reviewTick) ? ""
    : !Number.isFinite(worldTick) ? "Review pending"
    : reviewTick > worldTick ? `Pending review from tick ${reviewTick}, subject to request spacing.`
    : "Awaiting an eligible review, not an active model call.";
  workPolicyReview.hidden = workPolicyReview.textContent === "";
  if (schedule && alive(citizen)) {
    const timing = !latestState.running ? "Paused" : citizen.planning ? "Review in progress" : schedule.eligible ? `Queued for ${Math.floor(count(schedule.queueWaitMs) / 1000)}s` : `Eligible in ${Math.ceil(schedule.waitMs / 1000)}s at current speed`;
    workPolicyReview.textContent = `${timing} · ${text(schedule.reason)} · ${count(schedule.calls)} calls, ${count(schedule.rejected)} rejected.`;
    workPolicyReview.hidden = false;
  }
  const pendingPhone = [...(citizen.phone ? [citizen.phone.task] : []), ...(citizen.communications ?? [])];
  if (pendingPhone.length) workPolicyCopy.textContent += ` · Phone: ${pendingPhone.length} pending`;
  if (citizen.lastPlanMode) workPolicyCopy.textContent += citizen.lastPlanMode === 'continue' ? ' · Work retained at last review' : ' · Work replaced at last review';
  if (citizen.order?.effort?.ticks) workPolicyCopy.textContent += ` · ${count(citizen.order.effort.ticks)} work ticks invested in current step`;
  familyProposals.replaceChildren();
  const pairings = (latestState?.world?.familyProposals ?? []).filter(p => p.makerId === citizen.id || p.recipientId === citizen.id).slice(-4);
  for (const proposal of pairings) {
    const partnerId = proposal.makerId === citizen.id ? proposal.recipientId : proposal.makerId;
    familyProposals.append(make("p", "detail-copy", `Family with ${nameOf(partnerId)} · ${text(proposal.status)} · ${text(proposal.id)}`));
  }
  if (!pairings.length) familyProposals.append(make("p", "knowledge-source", "No partner-specific family proposals."));
  root.querySelector(".retained-badge").hidden = !(text(citizen.lastError).trim() && count(citizen.planCount) > 0);

  const order = activeOrder(citizen);
  const orderText = root.querySelector(".order-detail .detail-copy");
  orderText.textContent = order ? orderSummary(citizen) : "No long-lived order";
  const nextList = root.querySelector(".next-list");
  nextList.replaceChildren();
  const tasks = Array.isArray(citizen.tasks) ? citizen.tasks : [];
  if (!tasks.length) nextList.append(make("li", "", "No queued tasks"));
  else for (const task of tasks.slice(0, 4)) nextList.append(make("li", "", actionLabel(task)));
  root.querySelector(".character-detail .detail-copy").textContent = citizen.personality || "No character description reported";
  renderGoalChips(root.querySelector(".aspirations-detail .goal-list"), citizen.aspirations, "No aspirations reported");
  renderGoalChips(root.querySelector(".goals-detail .goal-list"), citizen.goals, "No current goals reported");
  const undertakingBlock = root.querySelector(".undertaking-detail");
  undertakingBlock.hidden = !citizen.undertaking;
  if (citizen.undertaking) {
    const undertaking = citizen.undertaking;
    const previous = citizen.undertakingHistory?.at(-1);
    undertakingBlock.querySelector("p").textContent = `${text(undertaking.objective)}. Success condition: ${text(undertaking.success)}. Citizen assessment: ${text(undertaking.status)}${undertaking.assessment ? ` (${text(undertaking.assessment.reason)})` : ""}. Since tick ${count(undertaking.startedAt)}: ${count(undertaking.completedActions)} orders completed, ${count(undertaking.failedActions)} failed. These counts do not establish goal completion.${previous?.assessment ? ` Previous: ${text(previous.status)} · ${text(previous.assessment.reason)}` : ""}`;
  }
  const progressBlock = root.querySelector(".strategy-progress-detail");
  const progress = strategyProgress(citizen, count(latestState?.world?.tick));
  progressBlock.hidden = !progress;
  if (progress) {
    const delta = value => `${value > 0 ? '+' : ''}${value}`;
    progressBlock.querySelector("p").textContent = `${progress.elapsedTicks} ticks: food ${delta(progress.inventoryChange.food)}, wood ${delta(progress.inventoryChange.wood)}, bread ${delta(progress.inventoryChange.bread)}, health ${delta(progress.healthChange)}. ${progress.consequentialCompletions} consequential actions completed.`;
  }
  const buildingList = root.querySelector(".building-list");
  buildingList.replaceChildren();
  const owned = worldBuildings()
    .filter((building) => building && building.ownerId !== undefined && String(building.ownerId) === String(citizen.id))
    .sort((a, b) => count(a.createdAt) - count(b.createdAt))
    .slice(0, 6);
  if (owned.length) {
    for (const building of owned) {
      const health = count(building.health);
      const maxHealth = Math.max(health, count(building.maxHealth));
      const destroyed = building.destroyed === true || (maxHealth > 0 && health <= 0);
      const away = Number.isFinite(Number(building.x)) && Number.isFinite(Number(citizen.x))
        && Number.isFinite(Number(building.y)) && Number.isFinite(Number(citizen.y))
        ? Math.abs(Number(building.x) - Number(citizen.x)) + Math.abs(Number(building.y) - Number(citizen.y)) : null;
      const entry = make("div", `knowledge-entry${destroyed ? " is-stale" : ""}`);
      entry.append(make("span", "", `${buildingKindLabel(building)} · ${text(building.id)} · ${destroyed ? "ruin" : `health ${health}/${maxHealth}`}`),
        make("span", "knowledge-source", `${destroyed ? "ruin" : "destructible"} · ${away === null ? "range unknown" : `${away} tiles away`} · built ${count(building.createdAt) ? shortTick(building.createdAt) : "tick unknown"}`));
      buildingList.append(entry);
    }
  } else {
    buildingList.append(make("p", "detail-copy", "No owned buildings reported."));
  }
  buildingList.append(make("p", "detail-copy", `${owned.length ? `Owned by ${name}. ` : ""}Actual world condition, not ${alive(citizen) ? "necessarily this citizen’s memory" : "a citizen’s memory"}.`));

  renderPrivateMessages(root.querySelector(".private-messages"), citizen, latestState?.world);
  const knowledge = nodeMemoryList(citizen);
  const tileCount = exploredTiles(citizen).size;
  const knownContainer = root.querySelector(".resource-knowledge");
  knownContainer.replaceChildren();
  knownContainer.append(make("p", "detail-copy", `${knowledge.length} remembered deposits · ${tileCount} explored tiles. This is ${name}’s snapshot, not live world stock.`));
  for (const node of knowledge) {
    const stale = nodeIsStale(node, count(latestState?.world?.tick));
    const entry = make("div", `knowledge-entry${stale ? " is-stale" : ""}`);
    const kind = node.kind === "tree" || node.kind === "wood" ? "Tree" : "Food";
    const observation = node.source === "report" ? `Reported by ${nameOf(node.reportedBy)}` : node.observedAt === null || node.observedAt === undefined ? "Seen · age unknown" : `Seen ${shortTick(node.observedAt)}`;
    entry.append(make("span", "", `${kind} · ${text(node.id, "deposit")}${node.level ? ` · L${node.level}` : ""} · ${count(node.yield ?? (node.kind === "tree" ? 5 : 1))}/harvest · stock ${count(node.stock)}/${count(node.capacity)}`), make("span", "knowledge-source", `${observation}${stale ? " · stale" : ""}`));
    knownContainer.append(entry);
  }
  if (!knowledge.length) knownContainer.append(make("p", "detail-copy", "No deposit knowledge reported yet."));
  const memories = Array.isArray(citizen.memories) ? citizen.memories : [];
  const memoryCopy = root.querySelector(".memories-extra p");
  const thought = text(citizen.thought).trim();
  memoryCopy.textContent = `${thought ? `Thought: ${thought}\n` : ""}${memories.length ? memories.slice(-5).reverse().map((memory) => `• ${text(memory)}`).join("\n") : "No memories reported."}`;
  const history = citizen.resourceHistory && typeof citizen.resourceHistory === "object" ? Object.values(citizen.resourceHistory) : [];
  const visits = history.reduce((total, item) => total + count(item.visits), 0);
  const emptyVisits = history.reduce((total, item) => total + count(item.emptyVisits), 0);
  const lostRaces = history.reduce((total, item) => total + count(item.lostRaces), 0);
  root.querySelector(".history-extra p").textContent = history.length
    ? `${visits} visits · ${emptyVisits} empty visits · ${lostRaces} lost harvest races across ${history.length} deposits.`
    : "No resource visit history reported.";
  const error = text(citizen.lastError).trim();
  const errorBox = root.querySelector(".citizen-error");
  errorBox.hidden = !error;
  errorBox.querySelector("p").textContent = error;
  const familyKey = `${(citizen.parents || []).join(",")}|${people.filter((person) => person.parents?.some((id) => String(id) === String(citizen.id))).map((person) => person.id).join(",")}`;
  if (familyKey !== lastInspectorFamilyKey) { lastInspectorFamilyKey = familyKey; setFamilyLinks(family, citizen, people); }
}

function communicationEntries(world) {
  const groups = {
    public: (world.board ?? []).map(item => ({ item, kind: "public", tick: item.tick, parties: `${nameOf(item.citizenId)} to everyone`, message: text(item.text) })),
    private: [
      ...(world.messages ?? []).map(item => ({ item, kind: "private", tick: item.tick, parties: `${nameOf(item.senderId)} to ${nameOf(item.recipientId)}`, message: text(item.text) })),
      ...(world.familyProposals ?? []).map(item => ({ item, kind: "family", tick: item.updatedAt ?? item.createdAt, parties: `${nameOf(item.makerId)} to ${nameOf(item.recipientId)}`, message: `Family proposal ${text(item.id)}: ${text(item.status)}` })),
    ],
    trades: (world.offers ?? []).map(item => ({ item, kind: "offer", tick: item.createdAt, parties: `${nameOf(item.makerId)} to ${item.recipient == null ? "anyone" : nameOf(item.recipient)}`,
      message: Number(item.wantAmount) === 0 ? `Gift: ${count(item.giveAmount)} ${text(item.give)}` : `Gives ${count(item.giveAmount)} ${text(item.give)}; wants ${count(item.wantAmount)} ${text(item.want)}` })),
  };
  for (const entries of Object.values(groups)) entries.sort((a,b) => count(b.tick) - count(a.tick) || String(b.item.id).localeCompare(String(a.item.id)));
  return groups;
}
function renderCommunications(world) {
  if (count(world.tick) < communicationTick) { expandedCommunications.clear(); communicationRenders.clear(); }
  communicationTick = count(world.tick);
  for (const [key, entries] of Object.entries(communicationEntries(world))) {
    const column = ui.communicationColumns[key];
    const signature = JSON.stringify(entries) + (key === 'trades' ? world.tick : '');
    if (communicationRenders.get(key) === signature) continue;
    communicationRenders.set(key, signature);
    const previousScroll = column.list.scrollTop;
    const previousHeight = column.list.scrollHeight;
    const nodes = entries.map(({ item, kind, tick, parties, message }) => {
      const row = make("article", "communication-entry");
      row.setAttribute("role", "listitem");
      row.dataset.id = String(item.id); row.dataset.kind = kind;
      const content = make("div", "communication-text", message);
      const notes = [];
      if (kind === "offer") notes.push(`${text(item.id)}${item.status === "open" ? ` · ${Math.max(0,count(item.expiresAt)-count(world.tick))} ticks left` : ""}`);
      if (Array.isArray(item.share) && item.share.length) notes.push(`Shared deposits: ${item.share.join(", ")}`);
      if (Array.isArray(item.shareBuildings) && item.shareBuildings.length) notes.push(`Shared buildings: ${item.shareBuildings.join(", ")}`);
      if (item.location && Number.isFinite(item.location.x) && Number.isFinite(item.location.y)) notes.push(`Shared location (${item.location.x}, ${item.location.y})`);
      const stamp = make("span", "communication-stamp");
      stamp.append(make("span", "communication-tick", shortTick(tick)), make("span", `communication-kind ${kind}`, kind === "offer" ? text(item.status, "Offer") : kind === "family" ? "Family" : kind === "public" ? "Public" : item.channel === "voice" ? "Nearby" : "Private"));
      row.append(make("span", "communication-parties", parties), stamp, content);
      if (notes.length) row.append(make("span", "communication-meta", notes.join(" · ")));
      if (message.length > 140 || message.split('\n').length > 3) {
        const entryKey = `${kind}-${item.id}`;
        content.id = `communication-body-${entryKey}`;
        const toggle = make("button", "communication-toggle");
        toggle.type = 'button';
        toggle.setAttribute('aria-controls', content.id);
        const update = () => {
          const expanded = expandedCommunications.has(entryKey);
          content.classList.toggle('is-collapsed', !expanded);
          toggle.textContent = expanded ? 'Show less' : 'Read more';
          toggle.setAttribute('aria-expanded', String(expanded));
        };
        toggle.addEventListener('click', () => {
          if (expandedCommunications.has(entryKey)) expandedCommunications.delete(entryKey);
          else expandedCommunications.add(entryKey);
          update();
        });
        update(); row.append(toggle);
      }
      return row;
    });
    column.list.replaceChildren(...nodes);
    if (previousScroll > 2) column.list.scrollTop = previousScroll + column.list.scrollHeight - previousHeight;
    column.empty.hidden = entries.length > 0;
    column.count.textContent = key === "trades" ? `${entries.filter(e => e.item.status === "open").length} open / ${entries.length} total` : `${entries.length}`;
  }
}
function renderFeed(container, items, limit, kind) {
  const shown = items.slice(-limit).reverse();
  container.replaceChildren();
  for (const item of shown) {
    const entry = make(kind === "event" ? "li" : "article", "feed-entry");
    const content = make("div", "feed-entry-content");
    const top = make("div", "feed-top");
    const who = item.citizenId === undefined
      ? kind === "event" ? "World event" : text(item.name, "Neighbor")
      : nameOf(item.citizenId);
    let summary = text(item.text);
    if (kind === "event" && item.citizenId !== undefined) {
      const author = allCitizens().find((person) => String(person.id) === String(item.citizenId));
      const lastError = text(author?.lastError).trim();
      if (lastError && summary.includes(lastError)) summary = "Plan review failed; previous plan remains in place.";
    }
    top.append(make("span", "feed-name", who), make("span", "feed-time", shortTick(item.tick)));
    content.append(top, make("p", "feed-text", summary));
    for (const line of shareInfoLines(item.share, kind === "board" ? allCitizens().find((person) => String(person.id) === String(item.citizenId)) : null)) {
      content.append(make("p", "private-message-share", line));
    }
    const sharedBuildings = sharedBuildingsLine(item.shareBuildings);
    if (sharedBuildings) content.append(make("p", "private-message-share", sharedBuildings));
    entry.append(content); container.append(entry);
  }
  return shown.length;
}
function clearActionPopups() {
  ui.actionLayer.replaceChildren();
  popupActors.clear();
  for (const record of markers.values()) record.button.classList.remove("has-popup");
  for (const timer of popupTimers) clearTimeout(timer);
  popupTimers.clear();
}
function actionPopup(citizen, label, world) {
  // Citizen view must never show another person's live private activity.
  if (mapMode === "citizen" && String(citizen.id) !== selectedId) return;
  const popup = make("span", "action-popup", label);
  popup.dataset.citizenId = citizen.id;
  const board = ui.mapBoard.getBoundingClientRect();
  const x = (count(citizen.x)+.5)/world.width*board.width;
  const y = (count(citizen.y)+.5)/world.height*board.height;
  popup.style.left = `${Math.min(Math.max(x,70),Math.max(70,board.width-70))}px`;
  popup.style.top = `${Math.max(52,y-25)}px`;
  for (const prior of ui.actionLayer.querySelectorAll(`[data-citizen-id="${citizen.id}"]`)) prior.remove();
  ui.actionLayer.append(popup);
  popupActors.add(String(citizen.id));
  markers.get(String(citizen.id))?.button.classList.add("has-popup");
  const timer = setTimeout(() => {
    popup.remove(); popupTimers.delete(timer);
    if (!ui.actionLayer.querySelector(`[data-citizen-id="${citizen.id}"]`)) {
      popupActors.delete(String(citizen.id));
      markers.get(String(citizen.id))?.button.classList.remove("has-popup");
    }
  }, 2200);
  popupTimers.add(timer);
}
function renderActionPopups(world) {
  const reset = count(world.tick) < popupTick;
  if (reset) { clearActionPopups(); activitySamples.clear(); popupEventId = null; }
  const events = Array.isArray(world.events) ? world.events : [];
  const fresh = popupEventId === null ? [] : events.slice(events.findIndex(event => event.id === popupEventId)+1);
  popupEventId = events.at(-1)?.id ?? popupEventId;
  const popped = new Set();
  for (const citizen of world.citizens ?? []) {
    const current = citizen.current;
    const activity = activityDisplay(citizen.activity);
    const match = /^(Harvesting|Baking|Building|Repairing|Guarding|Feeding|Proposing|Accepting|Declining|Cancelling|Resting|Trading|Striking|Meeting)/.exec(activity);
    const previous = activitySamples.get(citizen.id);
    const key = `${current?.task?.type ?? ""}:${current?.task?.target ?? ""}:${match?.[1] ?? ""}`;
    const cycle = previous && current?.remaining > previous.remaining;
    if (match && (!previous || previous.key !== key || cycle)) {
      actionPopup(citizen, match[1], world); popped.add(citizen.id);
    }
    activitySamples.set(citizen.id, { key, remaining: current?.remaining });
  }
  // Fast simulation can finish work between polls. Completion events fill those gaps.
  for (const event of fresh) {
    if (popped.has(event.citizenId)) continue;
    const citizen = (world.citizens ?? []).find(c => c.id === event.citizenId);
    if (!citizen) continue;
    const label = / gathered /.test(event.text) ? "Harvested" : /completed bake/.test(event.text) ? "Baked bread" : /accepted .*offer/.test(event.text) ? "Traded" : /sent a private message/.test(event.text) ? "Messaged" : /welcomed a child/.test(event.text) ? "New child" : null;
    if (label) { actionPopup(citizen,label,world); popped.add(citizen.id); }
  }
  popupTick = count(world.tick);
}
function renderPlanner(planner = {}) {
  const connection = text(planner.connection, "unchecked");
  ui.model.textContent = text(planner.model, "Local model");
  ui.modelState.textContent = connection === "ready" ? "Ready" : connection === "error" ? "Unavailable" : "Checking";
  ui.headerDot.classList.toggle("is-ready", connection === "ready");
  ui.headerDot.classList.toggle("is-error", connection === "error");
  const budget = planner.budget;
  const hasBudget = budget && Number.isFinite(budget.limitUsd) && budget.limitUsd > 0 && Number.isFinite(budget.chargedUsd) && Number.isFinite(budget.remainingUsd);
  if (hasBudget) {
    const used = Math.max(0, Number(budget.chargedUsd));
    const limit = Number(budget.limitUsd);
    ui.budgetMini.textContent = `$${used.toFixed(2)} / $${limit.toFixed(0)}`;
    ui.budgetStats.textContent = `$${used.toFixed(4)} used · $${Math.max(0, budget.remainingUsd).toFixed(4)} remaining of $${limit.toFixed(2)}`;
    ui.budgetFill.style.width = `${Math.max(0, Math.min(100, used / limit * 100))}%`;
    ui.budgetMeter.setAttribute("aria-label", `Budget ${used.toFixed(4)} of ${limit.toFixed(2)} dollars used`);
  } else {
    ui.budgetMini.textContent = ""; ui.budgetStats.textContent = "Not reported"; ui.budgetFill.style.width = "0%";
    ui.budgetMeter.setAttribute("aria-label", "Budget not reported");
  }
  ui.plannerStats.textContent = `${count(planner.requests)} ${planner.harness === 'semantic-tools' ? 'turns' : 'requests'} · ${count(planner.completed)} completed · ${count(planner.failed)} failed${planner.toolHarness ? ` · ${count(planner.toolHarness.modelCalls)} model calls · ${count(planner.toolHarness.toolCalls)} tools (${count(planner.toolHarness.toolErrors)} errors)` : ''}`;
  const minCitizen = count(planner.minCitizenIntervalSeconds) || 60;
  const minGlobal = count(planner.minGlobalIntervalSeconds) || 5;
  const next = Number(planner.nextCallInMs);
  ui.cooldown.textContent = `${minCitizen}s routine · ${count(planner.eventReviewIntervalSeconds) || 15}s after completion/failure · ${minGlobal}s global${planner.privateMessageReviewsImmediate ? " · private mail gets priority" : ""}${Number.isFinite(next) && next > 0 ? ` · next window ${Math.ceil(next / 1000)}s` : ""}`;
  if (Number.isFinite(planner.meanTurnMs)) ui.cooldown.textContent += ` · mean turn ${(planner.meanTurnMs / 1000).toFixed(1)}s · ${(planner.activeCitizenIds || []).length}/${count(planner.maxConcurrentTurns)} active`;
  if (planner.toolHarness?.modelCalls > 0 && Number.isFinite(planner.toolHarness.promptBytes)) {
    const metrics = planner.toolHarness;
    ui.cooldown.textContent += ` · mean call ${(metrics.modelCallMs / (metrics.measuredCalls || metrics.modelCalls) / 1000).toFixed(1)}s · ${(metrics.promptBytes / metrics.modelCalls / 1024).toFixed(1)} KiB/request · ${Math.round(metrics.inputTokens / (metrics.usageCalls || metrics.modelCalls))} input tokens/call`;
    if (metrics.requestParts) {
      const meanPart = part => ((metrics.requestParts[part] || 0) / metrics.modelCalls / 1024).toFixed(1);
      ui.cooldown.textContent += ` · mean wire KiB: tools ${meanPart('tools')} / observation ${meanPart('observation')} / history ${meanPart('publicHistory')} / private replay ${meanPart('privateReplay')}`;
    }
  }
  ui.plannerError.textContent = (planner.errorHistory || []).slice(-6).map(e => `Tick ${e.tick} · ${e.citizenName} · ${e.kind}${e.httpStatus ? ` HTTP ${e.httpStatus}` : ""} · ${e.resolvedAt === null ? "pending" : "recovered"}: ${e.message}`).join("\n") || text(planner.lastError).trim() || "No planner errors.";
  ui.retry.disabled = controlBusy || connection !== "error";
  ui.retry.hidden = connection !== "error";
  if (connection === "error") {
    ui.banner.hidden = false;
    const message = text(planner.lastError, "Model connection failed.");
    const budgetFailure = /budget|allowance|spend limit/i.test(message) || (hasBudget && Number(budget.remainingUsd) <= 0);
    ui.bannerText.textContent = budgetFailure
      ? "Model budget limit reached. The simulation is paused; see System & planner for details."
      : "Planner unavailable. Existing plans remain in place; see System & planner for details.";
    ui.retry.hidden = budgetFailure || Boolean(planner.providerFailure);
    if (planner.providerFailure) ui.bannerText.textContent = `${planner.providerFailure.message} Existing work continues while the simulation is running.`;
  } else if (!pollFailures && planner.activeErrors?.length) {
    const error = planner.activeErrors.at(-1);
    const delay = Math.max(0, Math.ceil((error.retryAt - Date.now()) / 1000));
    ui.banner.hidden = false;
    ui.bannerText.textContent = `${planner.activeErrors.length} citizen planning failure(s). ${error.citizenName}: ${error.httpStatus ? `HTTP ${error.httpStatus}. ` : ""}${error.message} ${delay ? `Retry eligible in ${delay}s.` : "Awaiting retry."} Existing work continues; details in System & planner.`;
  } else if (!pollFailures) ui.banner.hidden = true;
}
function renderState(state) {
  if (!state?.world) throw new Error("The server returned an incomplete world state.");
  if (state !== latestState) motionClock.receive(state.world.tick, state.running, state.speed, performance.now());
  latestState = state;
  const world = state.world;
  const tick = count(world.tick);
  const people = allCitizens(world);
  const living = people.filter(alive);
  if (!people.some((person) => String(person.id) === selectedId)) selectedId = String(living[0]?.id ?? people[0]?.id ?? "");
  ui.tick.textContent = `Tick ${tick}`;
  ui.clock.textContent = `· ${clock(tick)}`;
  ui.geographyNote.textContent = world.center
    ? "Center L3 → Ring 1 L2 → Ring 2 L1 · three tiers; quality changes yield only."
    : world.rings?.length ? "Compass quadrants · ring numbers increase outward." : "Compass quadrants · north-west, north-east, south-west, south-east.";
  ui.population.textContent = `${living.length} ${living.length === 1 ? "citizen" : "citizens"}`;
  ui.citizenCount.textContent = String(living.length);
  const running = Boolean(state.running);
  ui.headerLabel.textContent = running ? (state.speedLimitReason ? "Running · 1× (food emergency)" : "Running") : "Paused";
  ui.headerLabel.title = state.speedLimitReason ?? "";
  ui.headerDot.classList.toggle("is-running", running);
  ui.play.disabled = controlBusy || running;
  ui.pause.disabled = controlBusy || !running;
  ui.reset.disabled = controlBusy;
  ui.speed.disabled = controlBusy;
  ui.speed.value = [1, 3, 8].includes(Number(state.speed)) ? String(state.speed) : "1";
  const stats = world.stats || {};
  ui.resourceStats.textContent = `${count(stats.harvestedFood)} food · ${count(stats.harvestedWood)} wood`;
  ui.activityStats.textContent = `${count(stats.messages)} messages · ${count(stats.crafted)} crafts · ${count(stats.trades)} trades/gifts`;
  ui.lifeStats.textContent = `${count(stats.births)} births · ${count(stats.deaths)} deaths · ${count(stats.attacks)} attacks`;
  const built = stats.built ?? stats.buildingsBuilt;
  const baked = stats.baked ?? stats.breadBaked;
  const destroyedBuildings = stats.destroyed ?? stats.buildingsDestroyed;
  ui.buildingStats.textContent = built !== undefined || baked !== undefined || destroyedBuildings !== undefined
    ? `${count(built)} built · ${count(baked)} bread baked · ${count(destroyedBuildings)} destroyed`
    : "Not reported";
  renderMap(world);
  renderInspector(selectedCitizen());
  renderCommunications(world);
  ui.eventsEmpty.hidden = renderFeed(ui.eventList, Array.isArray(world.events) ? world.events : [], 80, "event") > 0;
  renderActionPopups(world);
  renderPlanner(state.planner || {});
}
function setPollError(error) {
  ui.banner.hidden = false;
  ui.bannerText.textContent = `World connection lost (${text(error?.message, "unknown error")}). Retrying automatically.`;
  ui.retry.hidden = true;
  ui.headerLabel.textContent = "Disconnected";
  ui.headerDot.classList.add("is-error");
}
function clearPollError() {
  if (!pollFailures && latestState?.planner?.connection !== "error" && !latestState?.planner?.activeErrors?.length) ui.banner.hidden = true;
}
function pollInterval() { return POLL_INTERVALS[Number(latestState?.speed)] ?? POLL_INTERVALS[1]; }
async function pollOnce() {
  if (controlBusy) { window.setTimeout(pollOnce, pollInterval()); return; }
  const epoch = controlEpoch;
  try {
    const response = await fetch("/api/state", { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`World status returned ${response.status}`);
    const state = await response.json();
    if (epoch === controlEpoch) {
      pollFailures = 0;
      renderState(state);
      clearPollError();
    }
  } catch (error) {
    if (epoch === controlEpoch) { pollFailures += 1; setPollError(error); }
  } finally {
    const delay = pollFailures ? Math.min(POLL_BACKOFF_MAX, 1000 * 2 ** Math.min(pollFailures - 1, 3)) : pollInterval();
    window.setTimeout(pollOnce, delay);
  }
}
async function sendControl(action, speed) {
  if (controlBusy) return;
  controlBusy = true;
  controlEpoch += 1;
  if (latestState) renderState(latestState);
  try {
    const response = await fetch("/api/control", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(speed === undefined ? { action } : { action, speed }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      let message = "";
      try { const payload = await response.json(); message = text(payload.error || payload.message); } catch { /* status is sufficient */ }
      throw new Error(message || `Control returned ${response.status}`);
    }
    pollFailures = 0;
    renderState(await response.json());
  } catch (error) {
    ui.banner.hidden = false;
    ui.bannerText.textContent = `Could not ${action === "retry" ? "retry the planner" : `${action} the simulation`}: ${text(error?.message, "unknown error")}`;
    ui.retry.hidden = true;
  } finally {
    controlBusy = false;
    if (latestState) renderState(latestState);
  }
}

ui.play.addEventListener("click", () => sendControl("play"));
ui.pause.addEventListener("click", () => sendControl("pause"));
ui.reset.addEventListener("click", () => sendControl("reset"));
ui.retry.addEventListener("click", () => sendControl("retry"));
ui.speed.addEventListener("change", () => { const speed = Number(ui.speed.value); if ([1, 3, 8].includes(speed)) sendControl("speed", speed); });
ui.overviewMode.addEventListener("click", () => setMode("overview"));
ui.citizenMode.addEventListener("click", () => setMode("citizen"));
window.addEventListener("resize", positionCitizenTooltip);
window.addEventListener("scroll", positionCitizenTooltip, true);
setupLayout();
pollOnce();
