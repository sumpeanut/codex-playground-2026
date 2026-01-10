// -------------------- Uniforms --------------------
struct Params {
  w: u32,
  h: u32,

  radius: u32,
  damage: u32,
  bondWeaken: u32,

  mx: u32,
  my: u32,
  mdown: u32,
  repair: u32,

  frame: u32,
  relaxIters: u32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: Params;

// Cell encoding (u32):
// bits 0..7   damage (0..255)   0 = intact, 255 = destroyed
// bit  8      solid flag (1=solid, 0=empty)
// (Destroyed implies empty)
@group(0) @binding(1) var<storage, read_write> cellsA: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellsB: array<u32>;

// Bonds encode “weld strength” (u32 0..255)
@group(0) @binding(3) var<storage, read_write> bondsH: array<u32>; // (w-1)*h
@group(0) @binding(4) var<storage, read_write> bondsV: array<u32>; // w*(h-1)

// Output visualization
@group(0) @binding(5) var outTex: texture_storage_2d<rgba8unorm, write>;

// -------------------- Helpers --------------------
fn idx(x: u32, y: u32) -> u32 { return y * params.w + x; }

fn getDmg(c: u32) -> u32 { return c & 0xFFu; }
fn getSolidBit(c: u32) -> u32 { return (c >> 8u) & 1u; }

fn getSolid(c: u32) -> bool {
  let d = getDmg(c);
  return getSolidBit(c) == 1u && d < 255u;
}

fn packCell(solid: bool, dmg: u32) -> u32 {
  let s = select(0u, 1u, solid);
  return (dmg & 0xFFu) | (s << 8u);
}

fn clampU32(v: u32, lo: u32, hi: u32) -> u32 { return max(lo, min(hi, v)); }

fn dist2(ax: i32, ay: i32, bx: i32, by: i32) -> u32 {
  let dx = ax - bx;
  let dy = ay - by;
  return u32(dx*dx + dy*dy);
}

// Bond strengths
fn bondH(x: u32, y: u32) -> u32 { // between (x,y) and (x+1,y)
  return bondsH[y * (params.w - 1u) + x] & 0xFFu;
}
fn bondV(x: u32, y: u32) -> u32 { // between (x,y) and (x,y+1)
  return bondsV[y * params.w + x] & 0xFFu;
}

fn emptyAtA(x: u32, y: u32) -> bool { return !getSolid(cellsA[idx(x,y)]); }
fn solidAtA(x: u32, y: u32) -> bool { return getSolid(cellsA[idx(x,y)]); }

// -------------------- Tunables --------------------
const COHESION_TH: u32 = 180u; // bonds >= this are "strong welds"
const SUPPORT_TH:  u32 = 90u;  // bonds < this allow separation (falling)

// Cohesion rule for falling (1-hop):
// If strongly welded to a neighbor, require that neighbor also has empty below.
// This makes slabs fall together instead of tearing immediately.
fn cohesion_ok_for_fall(x: u32, y: u32) -> bool {
  // Left neighbor strongly bonded?
  if (x > 0u) {
    let b = bondH(x - 1u, y);
    if (b >= COHESION_TH && getSolid(cellsA[idx(x - 1u, y)])) {
      if (y + 1u >= params.h || !emptyAtA(x - 1u, y + 1u)) { return false; }
    }
  }
  // Right neighbor strongly bonded?
  if (x + 1u < params.w) {
    let b = bondH(x, y);
    if (b >= COHESION_TH && getSolid(cellsA[idx(x + 1u, y)])) {
      if (y + 1u >= params.h || !emptyAtA(x + 1u, y + 1u)) { return false; }
    }
  }
  return true;
}

fn support_allows_fall(x: u32, y: u32) -> bool {
  if (y + 1u >= params.h) { return false; }
  return bondV(x, y) < SUPPORT_TH;
}

fn chunk_is_strong(x: u32, y: u32) -> bool {
  if (x + 1u >= params.w || y + 1u >= params.h) { return false; }
  if (!solidAtA(x, y) || !solidAtA(x + 1u, y) || !solidAtA(x, y + 1u) || !solidAtA(x + 1u, y + 1u)) {
    return false;
  }
  if (bondH(x, y) < COHESION_TH || bondH(x, y + 1u) < COHESION_TH) { return false; }
  if (bondV(x, y) < COHESION_TH || bondV(x + 1u, y) < COHESION_TH) { return false; }
  return true;
}

fn chunk_blocked_by_side_bonds(x: u32, y: u32) -> bool {
  // If the chunk is strongly bonded to side neighbors, don't allow it to shear away.
  if (x > 0u) {
    if (bondH(x - 1u, y) >= COHESION_TH && solidAtA(x - 1u, y)) { return true; }
    if (bondH(x - 1u, y + 1u) >= COHESION_TH && solidAtA(x - 1u, y + 1u)) { return true; }
  }
  if (x + 2u < params.w) {
    if (bondH(x + 1u, y) >= COHESION_TH && solidAtA(x + 2u, y)) { return true; }
    if (bondH(x + 1u, y + 1u) >= COHESION_TH && solidAtA(x + 2u, y + 1u)) { return true; }
  }
  return false;
}

fn chunk_can_fall(x: u32, y: u32) -> bool {
  if (!chunk_is_strong(x, y)) { return false; }
  if (y + 2u >= params.h) { return false; }
  if (!emptyAtA(x, y + 2u) || !emptyAtA(x + 1u, y + 2u)) { return false; }
  if (!support_allows_fall(x, y + 1u) || !support_allows_fall(x + 1u, y + 1u)) { return false; }
  if (chunk_blocked_by_side_bonds(x, y)) { return false; }
  return true;
}

// -------------------- Pass 1: Brush damage/repair --------------------
@compute @workgroup_size(16, 16)
fn brush(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.w || y >= params.h) { return; }
  if (params.mdown == 0u) { return; }

  let mx = i32(params.mx);
  let my = i32(params.my);
  let r  = i32(params.radius);
  let d2 = dist2(i32(x), i32(y), mx, my);
  if (d2 > u32(r*r)) { return; }

  let i = idx(x, y);
  var c = cellsA[i];

  if (params.repair == 1u) {
    let cd = getDmg(c);
    let nd = clampU32(cd - min(cd, params.damage), 0u, 255u);
    cellsA[i] = packCell(true, nd);
  } else {
    let cd = getDmg(c);
    let nd = clampU32(cd + params.damage, 0u, 255u);
    let alive = nd < 255u;
    cellsA[i] = packCell(alive, nd);
  }

  // Bonds around cell: weaken/repair
  if (x > 0u) {
    let bi = y * (params.w - 1u) + (x - 1u);
    var b = bondsH[bi] & 0xFFu;
    if (params.repair == 1u) {
      b = clampU32(b + params.bondWeaken, 0u, 255u);
    } else {
      b = clampU32(b - min(b, params.bondWeaken), 0u, 255u);
    }
    bondsH[bi] = b;
  }
  if (x + 1u < params.w) {
    let bi = y * (params.w - 1u) + x;
    var b = bondsH[bi] & 0xFFu;
    if (params.repair == 1u) {
      b = clampU32(b + params.bondWeaken, 0u, 255u);
    } else {
      b = clampU32(b - min(b, params.bondWeaken), 0u, 255u);
    }
    bondsH[bi] = b;
  }
  if (y > 0u) {
    let bi = (y - 1u) * params.w + x;
    var b = bondsV[bi] & 0xFFu;
    if (params.repair == 1u) {
      b = clampU32(b + params.bondWeaken, 0u, 255u);
    } else {
      b = clampU32(b - min(b, params.bondWeaken), 0u, 255u);
    }
    bondsV[bi] = b;
  }
  if (y + 1u < params.h) {
    let bi = y * params.w + x;
    var b = bondsV[bi] & 0xFFu;
    if (params.repair == 1u) {
      b = clampU32(b + params.bondWeaken, 0u, 255u);
    } else {
      b = clampU32(b - min(b, params.bondWeaken), 0u, 255u);
    }
    bondsV[bi] = b;
  }
}

// -------------------- Pass 2: Bond decay (optional cleanup) --------------------
@compute @workgroup_size(16, 16)
fn bonds_decay(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.w || y >= params.h) { return; }

  // Horizontal bonds
  if (x + 1u < params.w) {
    let a = cellsA[idx(x, y)];
    let bcell = cellsA[idx(x + 1u, y)];
    let bi = y * (params.w - 1u) + x;
    var s = bondsH[bi] & 0xFFu;
    if (!getSolid(a) || !getSolid(bcell)) {
      s = clampU32(s - min(s, 10u), 0u, 255u);
    }
    bondsH[bi] = s;
  }

  // Vertical bonds
  if (y + 1u < params.h) {
    let a = cellsA[idx(x, y)];
    let bcell = cellsA[idx(x, y + 1u)];
    let bi = y * params.w + x;
    var s = bondsV[bi] & 0xFFu;
    if (!getSolid(a) || !getSolid(bcell)) {
      s = clampU32(s - min(s, 10u), 0u, 255u);
    }
    bondsV[bi] = s;
  }
}

// -------------------- Pass 3: CA step with cohesion --------------------
@compute @workgroup_size(16, 16)
fn step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.w || y >= params.h) { return; }

  let i = idx(x, y);
  let c = cellsA[i];

  let ax = x & 0xFFFFFFFEu;
  let ay = y & 0xFFFFFFFEu;
  let strongChunk = chunk_is_strong(ax, ay);
  var tl = 0u;
  var tr = 0u;
  var bl = 0u;
  var br = 0u;
  if (strongChunk) {
    if (x != ax || y != ay) { return; }
    tl = cellsA[idx(ax, ay)];
    tr = cellsA[idx(ax + 1u, ay)];
    bl = cellsA[idx(ax, ay + 1u)];
    br = cellsA[idx(ax + 1u, ay + 1u)];
    cellsB[idx(ax, ay)] = tl;
    cellsB[idx(ax + 1u, ay)] = tr;
    cellsB[idx(ax, ay + 1u)] = bl;
    cellsB[idx(ax + 1u, ay + 1u)] = br;
  } else {
    // Default copy
    cellsB[i] = c;
  }

  if (!getSolid(c)) { return; }

  // Checkerboard to reduce write conflicts
  if (((x + y + (params.frame & 1u)) & 1u) != 0u) {
    return;
  }

  if (strongChunk) {
    if (chunk_can_fall(ax, ay)) {
      cellsB[idx(ax, ay)] = 0u;
      cellsB[idx(ax + 1u, ay)] = 0u;
      cellsB[idx(ax, ay + 1u)] = tl;
      cellsB[idx(ax + 1u, ay + 1u)] = tr;
      cellsB[idx(ax, ay + 2u)] = bl;
      cellsB[idx(ax + 1u, ay + 2u)] = br;
    }
    return;
  }

  // Try down
  if (y + 1u < params.h) {
    let belowI = idx(x, y + 1u);
    let belowC = cellsA[belowI];

    if (!getSolid(belowC) && support_allows_fall(x, y) && cohesion_ok_for_fall(x, y)) {
      cellsB[belowI] = c;
      cellsB[i]      = 0u;
      return;
    }

    // If blocked, try diagonals as rubble behavior.
    if (getSolid(belowC)) {
      // down-left
      if (x > 0u) {
        let dlI = idx(x - 1u, y + 1u);
        if (!getSolid(cellsA[dlI])) {
          // If we're strongly welded left/right, don't shear sideways
          let hb = bondH(x - 1u, y);
          if (hb < COHESION_TH && support_allows_fall(x, y) && cohesion_ok_for_fall(x, y)) {
            cellsB[dlI] = c;
            cellsB[i]   = 0u;
            return;
          }
        }
      }
      // down-right
      if (x + 1u < params.w) {
        let drI = idx(x + 1u, y + 1u);
        if (!getSolid(cellsA[drI])) {
          let hb = bondH(x, y);
          if (hb < COHESION_TH && support_allows_fall(x, y) && cohesion_ok_for_fall(x, y)) {
            cellsB[drI] = c;
            cellsB[i]   = 0u;
            return;
          }
        }
      }
    }
  }
}

// -------------------- Pass 4: Relaxation (settling/packing) --------------------
// Same move rules, but run multiple iterations per frame to settle piles.
// Uses its own checkerboard phase so repeated passes converge.
@compute @workgroup_size(16, 16)
fn relax(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.w || y >= params.h) { return; }

  let i = idx(x, y);
  let c = cellsA[i];

  let ax = x & 0xFFFFFFFEu;
  let ay = y & 0xFFFFFFFEu;
  let strongChunk = chunk_is_strong(ax, ay);
  var tl = 0u;
  var tr = 0u;
  var bl = 0u;
  var br = 0u;
  if (strongChunk) {
    if (x != ax || y != ay) { return; }
    tl = cellsA[idx(ax, ay)];
    tr = cellsA[idx(ax + 1u, ay)];
    bl = cellsA[idx(ax, ay + 1u)];
    br = cellsA[idx(ax + 1u, ay + 1u)];
    cellsB[idx(ax, ay)] = tl;
    cellsB[idx(ax + 1u, ay)] = tr;
    cellsB[idx(ax, ay + 1u)] = bl;
    cellsB[idx(ax + 1u, ay + 1u)] = br;
  } else {
    // Default copy
    cellsB[i] = c;
  }

  if (!getSolid(c)) { return; }

  // Alternate phase for relaxation (different from main step)
  // This reduces oscillation when multiple relax iters run.
  let phase = (params.frame >> 1u) & 1u;
  if (((x + y + phase) & 1u) != 0u) { return; }

  if (strongChunk) {
    if (chunk_can_fall(ax, ay)) {
      cellsB[idx(ax, ay)] = 0u;
      cellsB[idx(ax + 1u, ay)] = 0u;
      cellsB[idx(ax, ay + 1u)] = tl;
      cellsB[idx(ax + 1u, ay + 1u)] = tr;
      cellsB[idx(ax, ay + 2u)] = bl;
      cellsB[idx(ax + 1u, ay + 2u)] = br;
    }
    return;
  }

  // Prefer settling straight down if possible
  if (y + 1u < params.h) {
    let belowI = idx(x, y + 1u);
    let belowC = cellsA[belowI];

    if (!getSolid(belowC) && support_allows_fall(x, y) && cohesion_ok_for_fall(x, y)) {
      cellsB[belowI] = c;
      cellsB[i]      = 0u;
      return;
    }

    // If blocked, try a deterministic sideways settle
    if (getSolid(belowC)) {
      // Choose direction based on position parity to avoid bias waves
      let preferLeft = ((x ^ y ^ (params.frame & 1u)) & 1u) == 0u;

      if (preferLeft) {
        if (x > 0u) {
          let dlI = idx(x - 1u, y + 1u);
          if (!getSolid(cellsA[dlI])) {
            let hb = bondH(x - 1u, y);
            if (hb < COHESION_TH && support_allows_fall(x, y) && cohesion_ok_for_fall(x, y)) {
              cellsB[dlI] = c;
              cellsB[i]   = 0u;
              return;
            }
          }
        }
        if (x + 1u < params.w) {
          let drI = idx(x + 1u, y + 1u);
          if (!getSolid(cellsA[drI])) {
            let hb = bondH(x, y);
            if (hb < COHESION_TH && support_allows_fall(x, y) && cohesion_ok_for_fall(x, y)) {
              cellsB[drI] = c;
              cellsB[i]   = 0u;
              return;
            }
          }
        }
      } else {
        if (x + 1u < params.w) {
          let drI = idx(x + 1u, y + 1u);
          if (!getSolid(cellsA[drI])) {
            let hb = bondH(x, y);
            if (hb < COHESION_TH && support_allows_fall(x, y) && cohesion_ok_for_fall(x, y)) {
              cellsB[drI] = c;
              cellsB[i]   = 0u;
              return;
            }
          }
        }
        if (x > 0u) {
          let dlI = idx(x - 1u, y + 1u);
          if (!getSolid(cellsA[dlI])) {
            let hb = bondH(x - 1u, y);
            if (hb < COHESION_TH && support_allows_fall(x, y) && cohesion_ok_for_fall(x, y)) {
              cellsB[dlI] = c;
              cellsB[i]   = 0u;
              return;
            }
          }
        }
      }
    }
  }
}

// -------------------- Pass 5: Visualize --------------------
@compute @workgroup_size(16, 16)
fn visualize(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.w || y >= params.h) { return; }

  let c = cellsA[idx(x, y)];
  let solid = getSolid(c);
  let d = f32(getDmg(c)) / 255.0;

  var col: vec4<f32>;
  if (!solid) {
    col = vec4<f32>(0.06, 0.06, 0.07, 1.0);
  } else {
    // Color shifts with damage
    col = vec4<f32>(0.82 - 0.50*d, 0.85 - 0.70*d, 0.90 - 0.85*d, 1.0);
  }

  textureStore(outTex, vec2<i32>(i32(x), i32(y)), col);
}

// -------------------- Fullscreen Present --------------------
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex
fn vs_fullscreen(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  var uv = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0),
  );

  var o: VSOut;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = uv[vi];
  return o;
}

@group(0) @binding(0) var visTex: texture_2d<f32>;
@group(0) @binding(1) var visSamp: sampler;

@fragment
fn fs_present(in: VSOut) -> @location(0) vec4<f32> {
  return textureSample(visTex, visSamp, in.uv);
}
