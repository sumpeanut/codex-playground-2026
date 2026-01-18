import { WebSocketServer } from "ws";
import { performance } from "node:perf_hooks";
import { stepEntities } from "../src/sim/entity-stepper.js";

const PORT = Number(process.env.PORT || 8080);
const GRID_W = 256;
const GRID_H = 144;
const TICK_RATE_HZ = 15;
const TICK_MS = Math.round(1000 / TICK_RATE_HZ);

const wss = new WebSocketServer({ port: PORT });
const clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);

  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

function createEntity(id) {
  return {
    id,
    x: Math.floor(Math.random() * GRID_W),
    y: Math.floor(Math.random() * GRID_H),
    path: [],
    color: `hsl(${Math.random() * 360}, 70%, 60%)`,
    baseSpeed: 0.15,
    currentSpeed: 0.15,
    moveProgress: 0,
    fallVelocity: 0,
  };
}

function queueRandomStep(entity) {
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const [dx, dy] = directions[Math.floor(Math.random() * directions.length)];
  const nextX = Math.max(0, Math.min(GRID_W - 1, Math.floor(entity.x + dx)));
  const nextY = Math.max(0, Math.min(GRID_H - 1, Math.floor(entity.y + dy)));
  if (nextX === entity.x && nextY === entity.y) return;
  entity.path.push({
    x: nextX,
    y: nextY,
    falling: false,
    jumping: false,
    fallIndex: 0,
  });
}

const entities = Array.from({ length: 25 }, (_, index) => createEntity(index));
let frame = 0;

setInterval(() => {
  const tickStart = performance.now();

  for (const entity of entities) {
    if (entity.path.length === 0) {
      queueRandomStep(entity);
    }
  }

  stepEntities(entities);

  const payload = JSON.stringify({
    frame,
    entities: entities.map((entity) => ({
      id: entity.id,
      x: entity.x,
      y: entity.y,
      moveProgress: entity.moveProgress,
      color: entity.color,
    })),
  });

  const messageSize = Buffer.byteLength(payload);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }

  const tickDuration = performance.now() - tickStart;
  console.log(
    `tick ${frame} clients=${clients.size} size=${messageSize}B duration=${tickDuration.toFixed(2)}ms`
  );

  frame += 1;
}, TICK_MS);

console.log(`WebSocket server running on ws://localhost:${PORT}`);
