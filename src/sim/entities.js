import { createFlowField } from "../pathfinding/flow_field.ts";

export function createEntitySystem({ gridW, gridH, overlay, ui, pathfinder, requestPathAsync, isWorkerReady }) {
  const entities = [];
  let selectedEntity = null;
  let entityIdCounter = 0;

  const flowField = createFlowField({
    gridW,
    gridH,
    isWalkable: pathfinder.isWalkable,
    findNearestWalkable: pathfinder.findNearestWalkable,
  });

  const benchmark = {
    active: false,
    mode: "astar",
    frames: 0,
    frameSamples: 240,
    totalFrameMs: 0,
    totalUpdateMs: 0,
    totalPerEntityMs: 0,
    targetX: 0,
    targetY: 0,
    agentCount: 0,
  };

  function updateEntityCountUI() {
    if (ui.entityCount) ui.entityCount.textContent = entities.length;
  }

  function createEntity(x, y) {
    const entity = {
      id: entityIdCounter++,
      x,
      y,
      path: [],
      color: `hsl(${Math.random() * 360}, 70%, 60%)`,
      baseSpeed: 0.15,
      currentSpeed: 0.15,
      moveProgress: 0,
      fallVelocity: 0,
    };
    entities.push(entity);
    updateEntityCountUI();
    return entity;
  }

  function expandPath(path, startX, startY) {
    if (path.length === 0) return path;

    const expanded = [];
    let prevX = startX;
    let prevY = startY;

    for (const point of path) {
      const dx = point.x - prevX;
      const dy = point.y - prevY;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));

      const isFalling = dy > 0 && Math.abs(dy) > 1;
      const isJumpingUp = dy < 0 && Math.abs(dy) > 1;

      if (dist > 1) {
        const steps = dist;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          expanded.push({
            x: prevX + dx * t,
            y: prevY + dy * t,
            falling: isFalling,
            jumping: isJumpingUp,
            fallIndex: isFalling ? i : 0,
          });
        }
      } else {
        expanded.push({
          x: point.x,
          y: point.y,
          falling: false,
          jumping: false,
          fallIndex: 0,
        });
      }

      prevX = point.x;
      prevY = point.y;
    }

    return expanded;
  }

  const GRAVITY = 0.08;
  const MAX_FALL_SPEED = 1.5;
  const JUMP_INITIAL_SPEED = 0.4;

  function updatePathEntities({ benchmarkMode = false } = {}) {
    for (const entity of entities) {
      if (benchmarkMode && entity.path.length === 0) {
        const path = pathfinder.findPath(
          Math.floor(entity.x),
          Math.floor(entity.y),
          benchmark.targetX,
          benchmark.targetY
        );
        if (path.length > 0) {
          entity.path = expandPath(path, entity.x, entity.y);
          entity.moveProgress = 0;
        }
      }

      if (entity.path.length === 0) {
        entity.fallVelocity = 0;
        entity.currentSpeed = entity.baseSpeed;

        if (!pathfinder.isWalkable(Math.floor(entity.x), Math.floor(entity.y))) {
          const nearest = pathfinder.findNearestWalkable(Math.floor(entity.x), Math.floor(entity.y));
          if (nearest) {
            entity.x = nearest.x;
            entity.y = nearest.y;
          }
        }
        continue;
      }

      const nextPoint = entity.path[0];

      if (nextPoint.falling) {
        entity.fallVelocity = Math.min(entity.fallVelocity + GRAVITY, MAX_FALL_SPEED);
        entity.currentSpeed = entity.fallVelocity;
        if (entity.currentSpeed < 0.1) entity.currentSpeed = 0.1;
      } else if (nextPoint.jumping) {
        const jumpProgress = nextPoint.fallIndex || 1;
        entity.currentSpeed = Math.max(0.1, JUMP_INITIAL_SPEED - (jumpProgress * 0.05));
      } else {
        entity.currentSpeed = entity.baseSpeed;
        entity.fallVelocity = 0;
      }

      entity.moveProgress += entity.currentSpeed;
      if (entity.moveProgress >= 1) {
        entity.moveProgress = 0;
        const next = entity.path.shift();
        if (next) {
          entity.x = next.x;
          entity.y = next.y;
        }
      }
    }
  }

  function updateFlowFieldEntities() {
    for (const entity of entities) {
      const cellX = Math.floor(entity.x);
      const cellY = Math.floor(entity.y);
      const { dx, dy } = flowField.getVector(cellX, cellY);
      if (dx === 0 && dy === 0) {
        continue;
      }
      entity.x = Math.max(0, Math.min(gridW - 1, entity.x + dx * entity.baseSpeed));
      entity.y = Math.max(0, Math.min(gridH - 1, entity.y + dy * entity.baseSpeed));
    }
  }

  function updateEntities() {
    const updateStart = performance.now();

    if (benchmark.active) {
      if (benchmark.mode === "flow") {
        updateFlowFieldEntities();
      } else {
        updatePathEntities({ benchmarkMode: true });
      }
    } else {
      updatePathEntities();
    }

    const updateMs = performance.now() - updateStart;
    if (benchmark.active) {
      benchmark.totalUpdateMs += updateMs;
      benchmark.totalPerEntityMs += updateMs / Math.max(1, entities.length);
      benchmark.frames += 1;
      if (benchmark.frames >= benchmark.frameSamples) {
        finalizeBenchmarkPhase();
      }
    }
  }

  function drawEntities(overlayCtx) {
    const scaleX = overlay.width / gridW;
    const scaleY = overlay.height / gridH;

    for (const entity of entities) {
      const cx = entity.x * scaleX + scaleX / 2;
      const cy = entity.y * scaleY + scaleY / 2;
      const radius = Math.max(4, scaleX * 1.5);

      overlayCtx.beginPath();
      overlayCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      overlayCtx.fillStyle = entity.color;
      overlayCtx.fill();

      if (entity === selectedEntity) {
        overlayCtx.beginPath();
        overlayCtx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
        overlayCtx.strokeStyle = "white";
        overlayCtx.lineWidth = 2;
        overlayCtx.stroke();
        overlayCtx.lineWidth = 1;
      }

      if (entity.path.length > 0) {
        overlayCtx.beginPath();
        overlayCtx.moveTo(cx, cy);
        for (const point of entity.path) {
          overlayCtx.lineTo(
            point.x * scaleX + scaleX / 2,
            point.y * scaleY + scaleY / 2
          );
        }
        overlayCtx.strokeStyle = entity === selectedEntity ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.3)";
        overlayCtx.stroke();
      }
    }
  }

  function handlePointerDown({ gridX, gridY }) {
    const clickedEntity = entities.find((ent) => {
      const dx = Math.abs(ent.x - gridX);
      const dy = Math.abs(ent.y - gridY);
      return dx <= 2 && dy <= 2;
    });

    if (clickedEntity) {
      selectedEntity = clickedEntity;
      return true;
    }

    if (selectedEntity && isWorkerReady()) {
      const entityToMove = selectedEntity;
      requestPathAsync(
        Math.floor(entityToMove.x),
        Math.floor(entityToMove.y),
        gridX,
        gridY
      ).then((path) => {
        if (path.length > 0) {
          entityToMove.path = expandPath(path, entityToMove.x, entityToMove.y);
          entityToMove.moveProgress = 0;
        }
      });
      return true;
    }

    if (selectedEntity) {
      const path = pathfinder.findPath(
        Math.floor(selectedEntity.x),
        Math.floor(selectedEntity.y),
        gridX,
        gridY
      );
      if (path.length > 0) {
        selectedEntity.path = expandPath(path, selectedEntity.x, selectedEntity.y);
        selectedEntity.moveProgress = 0;
      }
      return true;
    }

    return false;
  }

  function spawnEntityOnSurface() {
    for (let attempts = 0; attempts < 100; attempts++) {
      const x = Math.floor(Math.random() * gridW);
      const y = Math.floor(Math.random() * gridH);
      if (pathfinder.isWalkable(x, y)) {
        return createEntity(x, y);
      }
    }
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        if (pathfinder.isWalkable(x, y)) {
          return createEntity(x, y);
        }
      }
    }
    return null;
  }

  function startRandomWalking() {
    setInterval(() => {
      if (benchmark.active) return;
      for (const entity of entities) {
        if (entity.path.length === 0 && isWorkerReady()) {
          const destX = Math.floor(Math.random() * gridW);
          const destY = Math.floor(Math.random() * gridH);

          requestPathAsync(
            Math.floor(entity.x),
            Math.floor(entity.y),
            destX,
            destY
          ).then((path) => {
            if (path.length > 0) {
              entity.path = expandPath(path, entity.x, entity.y);
              entity.moveProgress = 0;
            }
          });
        }
      }
    }, 2000);
  }

  function reset() {
    entities.length = 0;
    selectedEntity = null;
    updateEntityCountUI();
  }

  function startBenchmark({ agentCount = 400, frameSamples = 240 } = {}) {
    const centerX = Math.floor(gridW / 2);
    const centerY = Math.floor(gridH / 2);
    const target = pathfinder.findNearestWalkable(centerX, centerY) ?? { x: centerX, y: centerY };
    benchmark.targetX = target.x;
    benchmark.targetY = target.y;
    benchmark.frameSamples = frameSamples;
    benchmark.agentCount = agentCount;

    setupBenchmarkPhase("astar");
  }

  function setupBenchmarkPhase(mode) {
    benchmark.active = true;
    benchmark.mode = mode;
    benchmark.frames = 0;
    benchmark.totalFrameMs = 0;
    benchmark.totalUpdateMs = 0;
    benchmark.totalPerEntityMs = 0;

    reset();
    for (let i = 0; i < benchmark.agentCount; i++) {
      const entity = spawnEntityOnSurface();
      if (!entity) break;
    }

    if (mode === "astar") {
      for (const entity of entities) {
        const path = pathfinder.findPath(
          Math.floor(entity.x),
          Math.floor(entity.y),
          benchmark.targetX,
          benchmark.targetY
        );
        if (path.length > 0) {
          entity.path = expandPath(path, entity.x, entity.y);
          entity.moveProgress = 0;
        }
      }
    } else {
      flowField.build(benchmark.targetX, benchmark.targetY);
    }

    console.log(
      `[Benchmark] Starting ${mode === "astar" ? "A* baseline" : "flow field"} with ${entities.length} agents toward (${benchmark.targetX}, ${benchmark.targetY}).`
    );
  }

  function finalizeBenchmarkPhase() {
    const avgFrameMs = benchmark.totalFrameMs / Math.max(1, benchmark.frames);
    const avgUpdateMs = benchmark.totalUpdateMs / Math.max(1, benchmark.frames);
    const avgPerEntityMs = benchmark.totalPerEntityMs / Math.max(1, benchmark.frames);

    console.log(`[Benchmark] ${benchmark.mode === "astar" ? "A* baseline" : "flow field"} results`, {
      agents: entities.length,
      frames: benchmark.frames,
      avgFrameMs: Number(avgFrameMs.toFixed(3)),
      avgUpdateMs: Number(avgUpdateMs.toFixed(3)),
      avgPerEntityUpdateMs: Number(avgPerEntityMs.toFixed(5)),
    });

    if (benchmark.mode === "astar") {
      setupBenchmarkPhase("flow");
      return;
    }

    benchmark.active = false;
  }

  function recordFrameTime(frameMs) {
    if (!benchmark.active) return;
    benchmark.totalFrameMs += frameMs;
  }

  updateEntityCountUI();

  return {
    entities,
    handlePointerDown,
    spawnEntityOnSurface,
    startRandomWalking,
    updateEntities,
    drawEntities,
    reset,
    startBenchmark,
    recordFrameTime,
  };
}
