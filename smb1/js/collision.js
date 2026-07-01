// Collision system - AABB resolution
function resolveTileCollision(entity, level, direction) {
    // direction: 'vertical' or 'horizontal' - which axis to resolve first
    if (direction === 'vertical') {
        resolveVertical(entity, level);
    } else {
        resolveHorizontal(entity, level);
    }
}

function resolveVertical(entity, level) {
    entity.onGround = false;

    const left = Math.floor(entity.x / TILE);
    const right = Math.floor((entity.x + entity.w - 1) / TILE);

    if (entity.vy >= 0) {
        // Falling - check bottom
        const bottom = Math.floor((entity.y + entity.h) / TILE);
        for (let tx = left; tx <= right; tx++) {
            const tile = level.getTile(tx, bottom);
            if (isSolid(tile)) {
                // Land on tile
                entity.y = bottom * TILE - entity.h;
                entity.vy = 0;
                entity.onGround = true;
                return true;
            }
        }
    } else {
        // Rising - check top
        const top = Math.floor(entity.y / TILE);
        for (let tx = left; tx <= right; tx++) {
            const tile = level.getTile(tx, top);
            if (isSolid(tile)) {
                // Hit ceiling
                entity.y = (top + 1) * TILE;
                entity.vy = 0;
                return 'top'; // Signal that we hit the top of a tile
            }
        }
    }
    return false;
}

function resolveHorizontal(entity, level) {
    const top = Math.floor(entity.y / TILE);
    const bottom = Math.floor((entity.y + entity.h - 1) / TILE);

    if (entity.vx > 0) {
        // Moving right - check right side
        const right = Math.floor((entity.x + entity.w) / TILE);
        for (let ty = top; ty <= bottom; ty++) {
            const tile = level.getTile(right, ty);
            if (isSolid(tile)) {
                entity.x = right * TILE - entity.w;
                entity.vx = 0;
                return true;
            }
        }
    } else if (entity.vx < 0) {
        // Moving left - check left side
        const left = Math.floor(entity.x / TILE);
        for (let ty = top; ty <= bottom; ty++) {
            const tile = level.getTile(left, ty);
            if (isSolid(tile)) {
                entity.x = (left + 1) * TILE;
                entity.vx = 0;
                return true;
            }
        }
    }
    return false;
}

function resolveAABB(a, b) {
    // Check overlap
    const overlap = {
        left: a.x < b.x + b.w,
        right: a.x + a.w > b.x,
        top: a.y < b.y + b.h,
        bottom: a.y + a.h > b.y
    };

    if (!overlap.left || !overlap.right || !overlap.top || !overlap.bottom) {
        return false;
    }

    // Calculate overlap amounts
    const overlapLeft = (a.x + a.w) - b.x;
    const overlapRight = (b.x + b.w) - a.x;
    const overlapTop = (a.y + a.h) - b.y;
    const overlapBottom = (b.y + b.h) - a.y;

    // Resolve on smallest overlap
    const minOverlapX = Math.min(overlapLeft, overlapRight);
    const minOverlapY = Math.min(overlapTop, overlapBottom);

    if (minOverlapY < minOverlapX) {
        if (overlapTop < overlapBottom) {
            a.y = b.y - a.h;
        } else {
            a.y = b.y + b.h;
        }
    } else {
        if (overlapLeft < overlapRight) {
            a.x = b.x - a.w;
        } else {
            a.x = b.x + b.w;
        }
    }
    return true;
}

// Check if entity is in a pit (below ground level with no tiles)
function isInPit(entity, level) {
    const midX = Math.floor((entity.x + entity.w / 2) / TILE);
    const bottomY = Math.floor((entity.y + entity.h) / TILE);
    // If below the level rows
    return bottomY >= level.rows || entity.y > level.height;
}
