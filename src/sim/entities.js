import { stepEntities } from "./entity-stepper.js";

export function createEntitySystem({ gridW, gridH, overlay, ui, pathfinder, requestPathAsync, isWorkerReady }) {
  const entities = [];
  let selectedEntity = null;
  let entityIdCounter = 0;

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

  function updateEntities() {
    stepEntities(entities, { pathfinder });
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

  updateEntityCountUI();

  return {
    entities,
    handlePointerDown,
    spawnEntityOnSurface,
    startRandomWalking,
    updateEntities,
    drawEntities,
    reset,
  };
}
