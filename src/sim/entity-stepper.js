const GRAVITY = 0.08;
const MAX_FALL_SPEED = 1.5;
const JUMP_INITIAL_SPEED = 0.4;

export function stepEntities(entities, { pathfinder } = {}) {
  for (const entity of entities) {
    if (entity.path.length === 0) {
      entity.fallVelocity = 0;
      entity.currentSpeed = entity.baseSpeed;

      if (pathfinder?.isWalkable) {
        const gridX = Math.floor(entity.x);
        const gridY = Math.floor(entity.y);
        if (!pathfinder.isWalkable(gridX, gridY)) {
          const nearest = pathfinder.findNearestWalkable?.(gridX, gridY);
          if (nearest) {
            entity.x = nearest.x;
            entity.y = nearest.y;
          }
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
