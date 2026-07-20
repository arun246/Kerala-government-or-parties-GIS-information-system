const sceneHost = document.querySelector("#scene");
const statusEl = document.querySelector("#dataStatus");
const heightRange = document.querySelector("#heightRange");
const resetButton = document.querySelector("#resetView");
const lsgToggle = document.querySelector("#lsgToggle");
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const detailPanel = document.querySelector("#detailPanel");
const detailTitle = document.querySelector("#detailTitle");
const detailInfo = document.querySelector("#detailInfo");
const detailClose = document.querySelector("#detailClose");
const detailCanvas = document.querySelector("#detailCanvas");
const detailCtx = detailCanvas.getContext("2d");
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 100;
const SURFACE_OVERLAY_OFFSET = 0.055;

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
sceneHost.appendChild(canvas);

const fallbackKerala = [
  [74.86, 12.78], [75.06, 12.55], [75.14, 12.23], [75.33, 11.91], [75.55, 11.64],
  [75.74, 11.34], [75.87, 11.06], [75.96, 10.78], [76.06, 10.5], [76.22, 10.18],
  [76.34, 9.9], [76.46, 9.6], [76.58, 9.28], [76.71, 8.96], [76.88, 8.64],
  [77.18, 8.36], [77.36, 8.22], [77.28, 8.43], [77.18, 8.76], [77.08, 9.08],
  [77.0, 9.42], [76.93, 9.74], [76.9, 10.04], [76.86, 10.35], [76.78, 10.72],
  [76.7, 11.05], [76.58, 11.36], [76.45, 11.66], [76.24, 11.92], [76.05, 12.16],
  [75.82, 12.38], [75.5, 12.56], [75.2, 12.69], [74.86, 12.78]
];

const places = [
  ["Kasaragod", 75.0, 12.5], ["Kannur", 75.37, 11.87], ["Kozhikode", 75.78, 11.26],
  ["Wayanad", 76.08, 11.69], ["Malappuram", 76.07, 11.05], ["Palakkad", 76.65, 10.78],
  ["Thrissur", 76.21, 10.53], ["Kochi", 76.27, 9.93], ["Idukki", 77.06, 9.85],
  ["Kottayam", 76.52, 9.59], ["Alappuzha", 76.34, 9.5], ["Pathanamthitta", 76.78, 9.27],
  ["Kollam", 76.61, 8.89], ["Thiruvananthapuram", 76.94, 8.52]
];

const fallbackStreets = [
  {
    name: "Coastal corridor",
    kind: "primary",
    coords: [[74.95, 12.5], [75.37, 11.87], [75.78, 11.26], [76.07, 11.05], [76.21, 10.53], [76.27, 9.93], [76.34, 9.5], [76.61, 8.89], [76.94, 8.52]]
  },
  {
    name: "Hill corridor",
    kind: "secondary",
    coords: [[75.37, 11.87], [76.08, 11.69], [76.65, 10.78], [77.06, 9.85], [76.78, 9.27], [76.94, 8.52]]
  },
  {
    name: "Central link",
    kind: "secondary",
    coords: [[76.27, 9.93], [76.52, 9.59], [76.78, 9.27], [76.61, 8.89]]
  },
  {
    name: "Palakkad link",
    kind: "tertiary",
    coords: [[76.21, 10.53], [76.65, 10.78], [76.07, 11.05]]
  },
  {
    name: "Backwater link",
    kind: "tertiary",
    coords: [[76.27, 9.93], [76.34, 9.5], [76.52, 9.59]]
  }
];

let keralaRing = fallbackKerala;
let lsgFeatures = [];
let lsgBoundaryLines = [];
let lsgAreaPolygons = [];
let districtLabels = [];
let projected = null;
let meshes = [];
let streetLines = [];
let currentMode = "streets";
let width = 0;
let height = 0;
let yaw = -0.32;
let pitch = 0.95;
let zoom = 1;
let panX = 0;
let panY = 0;
let targetZoom = 1;
let targetPanX = 0;
let targetPanY = 0;
let dragging = false;
let panning = false;
let showLsgBoundaries = true;
let pointer = { x: 0, y: 0 };
let pointerStart = { x: 0, y: 0 };
let hovered = null;
let selectedLsg = null;
let selectedPbfPlaces = [];

resize();
init();

async function init() {
  await loadOpenDataKerala();

  try {
    const localRing = loadKeralaBoundaryFromData(window.KERALA_BOUNDARY_DATA);
    if (localRing.length > 20) {
      keralaRing = simplifyRing(localRing, 700);
      statusEl.textContent = lsgFeatures.length
        ? "OpenDataKerala LSG data + local Kerala boundary"
        : "Local Kerala boundary loaded";
    }
  } catch {
    try {
      const liveRing = await loadKeralaBoundary("https://nominatim.openstreetmap.org/search?state=Kerala&country=India&format=geojson&polygon_geojson=1&limit=1");
      if (liveRing.length > 20) {
        keralaRing = simplifyRing(liveRing, 700);
        statusEl.textContent = lsgFeatures.length
          ? "OpenDataKerala LSG data + live OSM boundary"
          : "Live OSM boundary loaded for Kerala";
      }
    } catch {
      if (!lsgFeatures.length) statusEl.textContent = "Using bundled Kerala outline";
    }
  }

  projected = createProjection(keralaRing);
  buildLsgBoundaryLines();
  buildDistrictData();
  await loadStreets();
  rebuildMeshes();
  requestAnimationFrame(draw);
}

async function loadOpenDataKerala() {
  try {
    const data = window.KERALA_LSG_DATA;
    if (!data) throw new Error("Local OpenDataKerala data script missing");
    lsgFeatures = Array.isArray(data.features) ? data.features : [];
    const lsgRings = lsgFeatures.flatMap((feature) => exteriorRings(feature.geometry));
    if (lsgRings.length) {
      keralaRing = outsideRingFromRings(lsgRings) || hullFromRings(lsgRings);
      statusEl.textContent = `Loaded ${lsgFeatures.length} LSG areas from OpenDataKerala`;
    }
  } catch {
    lsgFeatures = [];
    statusEl.textContent = "OpenDataKerala unavailable; using bundled outline";
  }
}

async function loadKeralaBoundary(url) {
  const response = await fetch(url, { headers: { Accept: "application/geo+json" } });
  if (!response.ok) throw new Error("Boundary request failed");
  const data = await response.json();
  const geometry = data.features?.[0]?.geometry;
  if (!geometry) throw new Error("Boundary missing");
  return largestExteriorRing(geometry);
}

function loadKeralaBoundaryFromData(data) {
  const geometry = data?.features?.[0]?.geometry;
  if (!geometry) throw new Error("Local boundary data missing");
  return largestExteriorRing(geometry);
}

function largestExteriorRing(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let largest = [];
  let area = 0;
  for (const polygon of polygons) {
    const ring = polygon[0];
    const ringArea = Math.abs(signedArea(ring));
    if (ringArea > area) {
      largest = ring;
      area = ringArea;
    }
  }
  return largest;
}

function exteriorRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates[0]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates.map((polygon) => polygon[0]);
  return [];
}

function outsideRingFromRings(rings) {
  const edges = new Map();
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = coordKey(ring[i]);
      const b = coordKey(ring[i + 1]);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const existing = edges.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        edges.set(key, { count: 1, a: ring[i], b: ring[i + 1] });
      }
    }
  }

  const neighbors = new Map();
  for (const edge of edges.values()) {
    if (edge.count !== 1) continue;
    const a = coordKey(edge.a);
    const b = coordKey(edge.b);
    if (!neighbors.has(a)) neighbors.set(a, []);
    if (!neighbors.has(b)) neighbors.set(b, []);
    neighbors.get(a).push(edge.b);
    neighbors.get(b).push(edge.a);
  }

  const visited = new Set();
  const outside = [];
  for (const start of neighbors.keys()) {
    if (visited.has(start)) continue;
    const ring = [];
    let current = keyToCoord(start);
    let previous = null;
    for (let guard = 0; guard < 12000; guard++) {
      const currentKey = coordKey(current);
      visited.add(currentKey);
      ring.push(current);
      const options = neighbors.get(currentKey) || [];
      const next = options.find((candidate) => coordKey(candidate) !== previous) || options[0];
      if (!next) break;
      previous = currentKey;
      current = next;
      if (coordKey(current) === start) {
        ring.push(current);
        break;
      }
    }
    if (ring.length > 12) outside.push(ring);
  }

  if (!outside.length) return null;
  outside.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  return simplifyRing(outside[0], 700);
}

function coordKey(point) {
  return `${Number(point[0]).toFixed(6)},${Number(point[1]).toFixed(6)}`;
}

function keyToCoord(key) {
  return key.split(",").map(Number);
}

function hullFromRings(rings) {
  const points = rings.flat().filter((point) => Array.isArray(point) && point.length >= 2);
  if (points.length < 3) return fallbackKerala;
  const sorted = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()]
    .sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  hull.push(hull[0]);
  return simplifyRing(hull, 700);
}

function signedArea(ring) {
  return ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function simplifyRing(ring, maxPoints) {
  if (ring.length <= maxPoints) return ring;
  const step = Math.ceil(ring.length / maxPoints);
  const sampled = ring.filter((_, index) => index % step === 0);
  const first = sampled[0];
  const last = sampled[sampled.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) sampled.push(first);
  return sampled;
}

function createProjection(ring) {
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const midLat = ((minLat + maxLat) / 2) * Math.PI / 180;
  const scale = 5.8 / Math.max((maxLon - minLon) * Math.cos(midLat), maxLat - minLat);
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const project = ([lon, lat]) => ({
    x: (lon - centerLon) * Math.cos(midLat) * scale,
    z: -(lat - centerLat) * scale
  });
  return { points: ring.map(project), project };
}

function buildLsgBoundaryLines() {
  lsgBoundaryLines = [];
  lsgAreaPolygons = [];
  if (!lsgFeatures.length) return;
  for (const feature of lsgFeatures) {
    const name = lsgName(feature.properties);
    const district = districtName(feature.properties);
    for (const ring of exteriorRings(feature.geometry)) {
      const fullPoints = ring.map(projected.project);
      const points = simplifyProjectedLine(fullPoints);
      lsgBoundaryLines.push({
        name,
        district,
        points
      });
      lsgAreaPolygons.push({
        name,
        district,
        properties: feature.properties || {},
        ring,
        points,
        fullPoints,
        center: polygonCenter(points),
        bounds: boundsOfRing(ring)
      });
    }
  }
}

function buildDistrictData() {
  districtLabels = [];
  if (!lsgAreaPolygons.length) return;
  const groups = new Map();
  for (const area of lsgAreaPolygons) {
    if (!groups.has(area.district)) groups.set(area.district, { name: area.district, x: 0, z: 0, count: 0 });
    const centroid = polygonCenter(area.points);
    const group = groups.get(area.district);
    group.x += centroid.x;
    group.z += centroid.z;
    group.count += 1;
  }
  districtLabels = [...groups.values()]
    .map((group) => ({
      name: group.name,
      point: { x: group.x / group.count, z: group.z / group.count }
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function lsgName(properties = {}) {
  const keys = ["name", "Name", "NAME", "lsg_name", "LSG_NAME", "local_body", "LOCAL_BODY", "panchayat", "municipality"];
  for (const key of keys) {
    if (properties[key]) return String(properties[key]);
  }
  const firstString = Object.values(properties).find((value) => typeof value === "string" && value.length > 2);
  return firstString || "LSG area";
}

function districtName(properties = {}) {
  return String(properties.District || properties.district || properties.DISTRICT || "Unknown district");
}

function polygonCenter(points) {
  if (!points.length) return { x: 0, z: 0 };
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, z: sum.z + point.z }), { x: 0, z: 0 });
  return { x: total.x / points.length, z: total.z / points.length };
}

function boundsOfRing(ring) {
  const lons = ring.map((point) => point[0]);
  const lats = ring.map((point) => point[1]);
  return {
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats)
  };
}

async function loadStreets() {
  streetLines = fallbackStreets.map((road) => ({
    name: road.name,
    kind: road.kind,
    points: road.coords.map(projected.project)
  }));

  try {
    const query = `
      [out:json][timeout:25];
      (
        way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)$"](8.15,74.75,12.9,77.55);
      );
      out geom 2600;
    `;
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: query
    });
    if (!response.ok) throw new Error("Street request failed");
    const data = await response.json();
    const roads = data.elements
      .filter((item) => item.type === "way" && item.geometry?.length > 1)
      .flatMap(splitRoadInsideKerala)
      .filter((road) => road.points.length > 1)
      .slice(0, 2600);
    if (roads.length > 20) {
      streetLines = roads;
      statusEl.textContent += " + live OSM streets";
    }
  } catch {
    statusEl.textContent += " + bundled street layer";
  }
}

function splitRoadInsideKerala(way) {
  const roads = [];
  let current = [];
  for (const point of way.geometry) {
    const lonLat = [point.lon, point.lat];
    if (pointInRing(lonLat, keralaRing)) {
      current.push(projected.project(lonLat));
    } else if (current.length > 1) {
      roads.push({
        name: way.tags?.name || way.tags?.ref || way.tags?.highway || "Road",
        kind: way.tags?.highway || "tertiary",
        points: simplifyProjectedLine(current)
      });
      current = [];
    } else {
      current = [];
    }
  }
  if (current.length > 1) {
    roads.push({
      name: way.tags?.name || way.tags?.ref || way.tags?.highway || "Road",
      kind: way.tags?.highway || "tertiary",
      points: simplifyProjectedLine(current)
    });
  }
  return roads;
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function simplifyProjectedLine(points) {
  if (points.length <= 80) return points;
  const step = Math.ceil(points.length / 80);
  const sampled = points.filter((_, index) => index % step === 0);
  sampled.push(points[points.length - 1]);
  return sampled;
}

function rebuildMeshes() {
  const lift = Number(heightRange.value);
  const points = projected.points;
  const center = points.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  center.x /= points.length;
  center.z /= points.length;
  meshes = [];

  for (let i = 0; i < points.length - 1; i++) {
    const a = surfacePoint(points[i], lift);
    const b = surfacePoint(points[i + 1], lift);
    meshes.push(face([{ ...points[i], y: -0.25 }, { ...points[i + 1], y: -0.25 }, b, a], "#186145", "#0f3b32"));
  }
}

function surfacePoint(point, lift) {
  const ridge = Math.max(0, (point.x + 0.6) / 4.6);
  return { x: point.x, z: point.z, y: 0.15 + ridge * ridge * 1.2 * lift };
}

function face(points, lightColor, darkColor) {
  const normal = normalOf(points);
  const light = Math.max(0.24, normal.x * -0.25 + normal.y * 0.88 + normal.z * 0.2);
  return { points, color: mix(darkColor, lightColor, light), depth: 0 };
}

function normalOf(points) {
  const [a, b, c] = points;
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const n = {
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x
  };
  const length = Math.hypot(n.x, n.y, n.z) || 1;
  return { x: n.x / length, y: n.y / length, z: n.z / length };
}

function mix(a, b, amount) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const value = ca.map((channel, index) => Math.round(channel + (cb[index] - channel) * amount));
  return `rgb(${value[0]}, ${value[1]}, ${value[2]})`;
}

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function draw(time = 0) {
  zoom += (targetZoom - zoom) * 0.16;
  const centerLift = surfacePoint({ x: 0, z: 0 }, Number(heightRange.value));
  const sinX = Math.sin(pitch);
  const cosX = Math.cos(pitch);
  const centerDepth = centerLift.y * sinX + 9;
  const centerPerspective = (Math.min(width, height) * 0.9 * zoom) / centerDepth;
  targetPanX = 0;
  targetPanY = centerLift.y * cosX * centerPerspective;
  panX += (targetPanX - panX) * 0.18;
  panY += (targetPanY - panY) * 0.18;

  ctx.clearRect(0, 0, width, height);
  drawSky();
  drawMap();
  drawDistrictAreas();
  drawStreets();
  drawLsgBoundaries();
  drawSelectedLsg();
  drawSelectedPbfPlaces();
  drawMarkers();
  requestAnimationFrame(draw);
}

function drawSky() {
  ctx.fillStyle = "#3f9f3f";
  ctx.fillRect(0, 0, width, height);
}

function drawMap() {
  const projectedMeshes = meshes.map((mesh) => {
    const screen = mesh.points.map(project3d);
    const depth = screen.reduce((sum, p) => sum + p.depth, 0) / screen.length;
    return { ...mesh, screen, depth };
  }).sort((a, b) => b.depth - a.depth);

  if (currentMode !== "outline") {
    for (const mesh of projectedMeshes) {
      ctx.fillStyle = mesh.color;
      ctx.beginPath();
      mesh.screen.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
      ctx.fill();
    }
    drawTopSurface();
  }

  const outline = projected.points.map((point) => project3d(surfacePoint(point, Number(heightRange.value))));
  ctx.strokeStyle = currentMode === "terrain" ? "rgba(236, 255, 242, 0.55)" : "rgba(245, 255, 248, 0.95)";
  ctx.lineWidth = currentMode === "outline" ? 3 : 1.4;
  ctx.beginPath();
  outline.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  ctx.stroke();
}

function drawTopSurface() {
  const surface = projected.points.map((point) => project3d(surfacePoint(point, Number(heightRange.value))));
  if (surface.length < 3) return;
  const gradient = ctx.createLinearGradient(0, height * 0.25, width, height * 0.75);
  gradient.addColorStop(0, currentMode === "streets" ? "#46c987" : "#3dba79");
  gradient.addColorStop(0.55, currentMode === "streets" ? "#2eaa70" : "#2d9864");
  gradient.addColorStop(1, "#1f7554");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  surface.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  ctx.fill();
}

function drawDistrictAreas() {
  if (currentMode !== "districts" || !lsgAreaPolygons.length) return;
  ctx.save();
  for (const area of lsgAreaPolygons) {
    const screen = area.points.map((point) => {
      const lifted = surfacePoint(point, Number(heightRange.value));
      return project3d({ ...lifted, y: lifted.y + 0.14 });
    });
    if (screen.length < 3) continue;
    ctx.fillStyle = districtColor(area.district, 0.74);
    ctx.beginPath();
    screen.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawStreets() {
  if (currentMode !== "streets") return;
  const roads = streetLines
    .map((road) => ({
      ...road,
      screen: road.points.map((point) => project3d({ ...surfacePoint(point, Number(heightRange.value)), y: surfacePoint(point, Number(heightRange.value)).y + 0.09 }))
    }))
    .sort((a, b) => roadWeight(a.kind) - roadWeight(b.kind));

  for (const road of roads) {
    const weight = roadWeight(road.kind);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(8, 22, 17, 0.78)";
    ctx.lineWidth = weight + 3;
    strokePath(road.screen);
    ctx.strokeStyle = roadColor(road.kind);
    ctx.lineWidth = weight;
    strokePath(road.screen);
  }
}

function drawLsgBoundaries() {
  if (!showLsgBoundaries || !lsgBoundaryLines.length || currentMode === "terrain") return;
  ctx.save();
  ctx.strokeStyle = currentMode === "districts"
    ? "rgba(255, 255, 255, 0.3)"
    : currentMode === "streets"
      ? "rgba(225, 255, 238, 0.72)"
      : "rgba(202, 255, 226, 0.55)";
  ctx.lineWidth = currentMode === "districts" ? 0.55 : currentMode === "streets" ? 1.15 : 1.2;
  ctx.setLineDash(currentMode === "streets" ? [5, 4] : []);
  for (const boundary of lsgBoundaryLines) {
    const screen = boundary.points.map((point) => {
      const lifted = surfacePoint(point, Number(heightRange.value));
      return project3d({ ...lifted, y: lifted.y + SURFACE_OVERLAY_OFFSET });
    });
    strokePath(screen);
  }
  ctx.restore();
}

function drawSelectedLsg() {
  if (!selectedLsg) return;
  const outlinePoints = selectedLsg.fullPoints || selectedLsg.points;
  const screen = outlinePoints.map((point) => {
    const lifted = surfacePoint(point, Number(heightRange.value));
    return project3d({ ...lifted, y: lifted.y + SURFACE_OVERLAY_OFFSET + 0.02 });
  });
  if (screen.length < 3) return;
  ctx.save();
  ctx.fillStyle = "rgba(255, 229, 125, 0.26)";
  ctx.strokeStyle = "rgba(255, 242, 166, 0.98)";
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  ctx.beginPath();
  screen.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const liftedCenter = surfacePoint(selectedLsg.center, Number(heightRange.value));
  const center = project3d({ ...liftedCenter, y: liftedCenter.y + SURFACE_OVERLAY_OFFSET + 0.08 });
  ctx.font = "800 13px Inter, sans-serif";
  ctx.textBaseline = "middle";
  const textWidth = ctx.measureText(selectedLsg.name).width;
  ctx.fillStyle = "rgba(5, 16, 14, 0.78)";
  roundRect(center.x - textWidth / 2 - 9, center.y - 13, textWidth + 18, 26, 6);
  ctx.fill();
  ctx.fillStyle = "#fff7bf";
  ctx.fillText(selectedLsg.name, center.x - textWidth / 2, center.y);
  ctx.restore();
}

function drawSelectedPbfPlaces() {
  if (!selectedLsg || !selectedPbfPlaces.length) return;
  const maxPlaces = Math.min(selectedPbfPlaces.length, zoom > 8 ? 1200 : 450);
  ctx.save();
  for (let i = 0; i < maxPlaces; i++) {
    const place = selectedPbfPlaces[i];
    const projectedPlace = projected.project([place.lon, place.lat]);
    const lifted = surfacePoint(projectedPlace, Number(heightRange.value));
    const screen = project3d({ ...lifted, y: lifted.y + SURFACE_OVERLAY_OFFSET + 0.09 });
    const important = place.kind === "city" || place.kind === "town" || place.kind === "village";
    ctx.fillStyle = important ? "#fff1a6" : "#9be7d0";
    ctx.strokeStyle = "rgba(5, 20, 18, 0.82)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, important ? 4.3 : 3.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}


function strokePath(points) {
  if (points.length < 2) return;
  ctx.beginPath();
  points.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.stroke();
}

function roadWeight(kind) {
  if (kind === "motorway" || kind === "trunk" || kind === "primary") return 3.2;
  if (kind === "secondary") return 2.4;
  return 1.7;
}

function roadColor(kind) {
  if (kind === "motorway" || kind === "trunk") return "rgba(255, 207, 99, 0.98)";
  if (kind === "primary") return "rgba(255, 231, 132, 0.96)";
  if (kind === "secondary") return "rgba(242, 246, 218, 0.9)";
  return "rgba(177, 229, 201, 0.86)";
}

function districtColor(name, alpha = 1) {
  const palette = [
    [68, 181, 136], [234, 184, 79], [86, 160, 214], [224, 111, 105],
    [139, 199, 91], [194, 134, 214], [235, 143, 73], [84, 198, 189],
    [213, 91, 136], [172, 189, 83], [113, 139, 221], [230, 205, 99],
    [104, 204, 134], [218, 126, 174]
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const color = palette[hash % palette.length];
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function drawMarkers() {
  hovered = null;
  const source = [];
  if (currentMode === "districts" && districtLabels.length) {
    source.push(...districtLabels.map((district) => ({ name: district.name, point: district.point, type: "district" })));
  }
  source.push(...places.map(([name, lon, lat]) => ({ name, point: projected.project([lon, lat]), lon, lat, type: "place" })));
  const markerData = source.map((item) => {
    const lifted = surfacePoint(item.point, Number(heightRange.value));
    const screen = project3d({ ...lifted, y: lifted.y + (item.type === "district" ? 0.28 : 0.18) });
    return { ...item, screen };
  }).sort((a, b) => b.screen.depth - a.screen.depth);

  for (const item of markerData) {
    const distance = Math.hypot(pointer.x - item.screen.x, pointer.y - item.screen.y);
    const active = !(selectedLsg && item.type === "place") && distance < 16;
    if (active) hovered = item.name;
    if (item.type !== "district") {
      ctx.fillStyle = active ? "#fff1a6" : "#ffd36e";
      ctx.strokeStyle = "rgba(25, 20, 6, 0.72)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(item.screen.x, item.screen.y, active ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (item.type === "district" || currentMode === "streets" || active) {
      ctx.font = item.type === "district" ? "800 13px Inter, sans-serif" : "700 12px Inter, sans-serif";
      ctx.textBaseline = "middle";
      const label = item.type === "place" && active ? `${item.name} ${item.lat.toFixed(2)}, ${item.lon.toFixed(2)}` : item.name;
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(5, 16, 14, 0.72)";
      roundRect(item.screen.x + 9, item.screen.y - 10, textWidth + 14, 20, 6);
      ctx.fill();
      ctx.fillStyle = "#f6fff8";
      ctx.fillText(label, item.screen.x + 16, item.screen.y);
    }
  }
  canvas.style.cursor = hovered ? "pointer" : dragging ? "grabbing" : "grab";
}

function selectLsgAt(x, y) {
  if (!lsgAreaPolygons.length) return;
  for (let i = lsgAreaPolygons.length - 1; i >= 0; i--) {
    const area = lsgAreaPolygons[i];
    const hitPoints = area.fullPoints || area.points;
    const screen = hitPoints.map((point) => {
      const lifted = surfacePoint(point, Number(heightRange.value));
      return project3d({ ...lifted, y: lifted.y + 0.18 });
    });
    if (pointInScreenPolygon({ x, y }, screen)) {
      selectedLsg = area;
      selectedPbfPlaces = pbfPlacesInArea(area);
      showLsgDetail(area, selectedPbfPlaces);
      return;
    }
  }
}

function pointInScreenPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y)) && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pbfPlacesInArea(area) {
  const allPlaces = window.KERALA_PBF_PLACES?.places || [];
  const bounds = area.bounds;
  const matches = [];
  for (const place of allPlaces) {
    if (place.lon < bounds.minLon || place.lon > bounds.maxLon || place.lat < bounds.minLat || place.lat > bounds.maxLat) continue;
    if (pointInRing([place.lon, place.lat], area.ring)) matches.push(place);
  }
  return matches;
}

function showLsgDetail(area, pbfPlaces) {
  detailPanel.classList.remove("hidden");
  detailTitle.textContent = area.name;
  const props = area.properties;
  const counts = countByKind(pbfPlaces);
  const topKinds = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([kind, count]) => `${kind}: ${count}`)
    .join(", ") || "No named PBF places found inside this boundary";
  const examples = pbfPlaces
    .slice(0, 8)
    .map((place) => `${place.name} (${place.kind})`)
    .join(", ") || "No examples available";

  detailInfo.innerHTML = [
    `<div><strong>District:</strong> ${escapeHtml(area.district)}</div>`,
    `<div><strong>Local body type:</strong> ${escapeHtml(props.local_auth || "Unknown")}</div>`,
    `<div><strong>LSGI code:</strong> ${escapeHtml(props.LSGI_Code || "N/A")}</div>`,
    `<div><strong>Block:</strong> ${escapeHtml(props.BlockName || "N/A")}</div>`,
    `<div><strong>PBF named places inside:</strong> ${pbfPlaces.length}</div>`,
    `<div><strong>PBF categories:</strong> ${escapeHtml(topKinds)}</div>`,
    `<div><strong>Examples:</strong> ${escapeHtml(examples)}</div>`
  ].join("");
  drawDetailCanvas(area, pbfPlaces);
}

function countByKind(items) {
  return items.reduce((counts, item) => {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
    return counts;
  }, {});
}

function drawDetailCanvas(area, pbfPlaces) {
  const w = detailCanvas.width;
  const h = detailCanvas.height;
  detailCtx.clearRect(0, 0, w, h);
  const gradient = detailCtx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, "#071411");
  gradient.addColorStop(1, "#123125");
  detailCtx.fillStyle = gradient;
  detailCtx.fillRect(0, 0, w, h);

  const bounds = area.bounds;
  const pad = 26;
  const lonSpan = Math.max(0.001, bounds.maxLon - bounds.minLon);
  const latSpan = Math.max(0.001, bounds.maxLat - bounds.minLat);
  const scale = Math.min((w - pad * 2) / lonSpan, (h - pad * 2) / latSpan);
  const xOffset = (w - lonSpan * scale) / 2;
  const yOffset = (h - latSpan * scale) / 2;
  const mapPoint = ([lon, lat]) => ({
    x: xOffset + (lon - bounds.minLon) * scale,
    y: h - yOffset - (lat - bounds.minLat) * scale
  });

  detailCtx.fillStyle = "rgba(67, 194, 126, 0.48)";
  detailCtx.strokeStyle = "rgba(236, 255, 242, 0.9)";
  detailCtx.lineWidth = 2;
  detailCtx.beginPath();
  area.ring.forEach((coord, index) => {
    const p = mapPoint(coord);
    index ? detailCtx.lineTo(p.x, p.y) : detailCtx.moveTo(p.x, p.y);
  });
  detailCtx.closePath();
  detailCtx.fill();
  detailCtx.stroke();

  const sample = pbfPlaces.slice(0, 450);
  for (const place of sample) {
    const p = mapPoint([place.lon, place.lat]);
    detailCtx.fillStyle = place.kind === "village" || place.kind === "town" || place.kind === "city"
      ? "#ffd36e"
      : "#9be7d0";
    detailCtx.beginPath();
    detailCtx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
    detailCtx.fill();
  }

  detailCtx.fillStyle = "rgba(5, 20, 18, 0.8)";
  detailCtx.fillRect(12, 12, Math.min(360, w - 24), 34);
  detailCtx.fillStyle = "#f6fff8";
  detailCtx.font = "800 13px Inter, sans-serif";
  detailCtx.fillText(`${area.name} - ${pbfPlaces.length} PBF places`, 22, 34);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function project3d(point) {
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);
  const sinX = Math.sin(pitch);
  const cosX = Math.cos(pitch);
  const x1 = point.x * cosY - point.z * sinY;
  const z1 = point.x * sinY + point.z * cosY;
  const y1 = point.y * cosX - z1 * sinX;
  const z2 = point.y * sinX + z1 * cosX + 9;
  const perspective = (Math.min(width, height) * 0.9 * zoom) / z2;
  return {
    x: width / 2 + panX + x1 * perspective,
    y: height / 2 + panY - y1 * perspective,
    depth: z2
  };
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function resize() {
  width = innerWidth;
  height = innerHeight;
  canvas.width = Math.floor(width * devicePixelRatio);
  canvas.height = Math.floor(height * devicePixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  panning = event.button === 2 || event.shiftKey;
  pointer = { x: event.clientX, y: event.clientY };
  pointerStart = pointer;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  const next = { x: event.clientX, y: event.clientY };
  const dx = next.x - pointer.x;
  const dy = next.y - pointer.y;
  if (dragging && panning) {
    panX += dx;
    panY += dy;
  } else if (dragging) {
    yaw += dx * 0.008;
    pitch = Math.max(0.35, Math.min(1.25, pitch + dy * 0.006));
  }
  pointer = next;
});

canvas.addEventListener("pointerup", (event) => {
  const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  if (!panning && moved < 6) selectLsgAt(event.clientX, event.clientY);
  dragging = false;
  panning = false;
});

canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const previousZoom = zoom;
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom * Math.exp(-event.deltaY * 0.0011)));
  targetZoom = nextZoom;
}, { passive: false });

heightRange.addEventListener("input", rebuildMeshes);
lsgToggle.addEventListener("change", () => {
  showLsgBoundaries = lsgToggle.checked;
});
detailClose.addEventListener("click", () => {
  selectedLsg = null;
  selectedPbfPlaces = [];
  detailPanel.classList.add("hidden");
});
resetButton.addEventListener("click", () => {
  yaw = -0.32;
  pitch = 0.95;
  zoom = 1;
  panX = 0;
  panY = 0;
  targetZoom = 1;
  targetPanX = 0;
  targetPanY = 0;
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    modeButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    currentMode = button.dataset.mode;
  });
});

addEventListener("resize", resize);
