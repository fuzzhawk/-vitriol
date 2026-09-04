/* ============================================================
   pilot.js — an AI that plays the game.

   It does not move anything. It writes into the same input struct a
   keyboard and mouse fill, and the ordinary Player.step consumes it.
   That is the whole design: autopilot, the allies you thaw out, and
   any attract mode later are one brain, and anything the pilot can do
   is by construction something a player could have done.

   Navigation is reactive rather than planned. These levels are a
   ribbon of decks with pits between them, so probing a short way
   ahead against the same `plats` the physics uses gets a body from one
   end to the other without a pathfinder — and a reactive pilot
   recovers from being knocked off a ledge, which a baked path does
   not.
   ============================================================ */
window.PILOT = (function () {
  "use strict";

  const LV = window.GREEBLEWORKS.LV;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  const CFG = {
    probe: 22,           // how far ahead to look for pits and walls
    gapJump: 34,         // a gap wider than this wants the second jump
    arrive: 14,          // close enough to a waypoint
    engageRange: 200,    // will shoot at this
    dangerRange: 46,     // backs off inside this
    leadFactor: 0.85,    // how much to lead a moving target
    reactMin: 0.06,      // reaction delay, so it is not frame perfect
    reactMax: 0.16,
    stuckTime: 0.9,      // no progress for this long means try something else
    aimJitter: 0.055,
    climbUp: 26,         // a goal this far above wants a jump, not a walk
    climbReach: 118,     // the most height two jumps will buy
    ledgeScan: 130,      // how far sideways to look for a way up
    giveUpT: 3.2,        // chasing one pickup for this long is a trap
    giveUpFor: 8,        // ...so ignore it for this long and move on
    backMax: 1.1,        // the most time to spend giving ground
    pushFor: 2.2,        // ...then close regardless, for this long
    climbNear: 80,       // only climb toward a goal we are nearly under
    stepUp: 44,          // a rise this small is a step, not a hole
    dropNear: 140,       // only drop off a deck when nearly over the goal
    dropDrop: 130,       // ...and only onto floor no further down than this
    faceBand: 34,        // a threat within this much height is in our face
    probeWindow: 0.5,    // how often to ask whether we are getting anywhere
    probeMove: 9,        // ...and how far counts as getting somewhere
    edge: 16             // jump a pit from this close to its lip, not on sight
  };

  function Pilot(actor, opts) {
    this.a = actor;
    this.o = opts || {};
    this.react = 0;
    this.target = null;        // the hostile it is shooting at
    this.goal = null;          // where it is trying to get to
    this.stuck = 0;
    this.lastX = actor.x;
    this.unstickDir = 0;
    this.unstickT = 0;
    this.jumpCool = 0;
    this.aimNoise = Math.random() * 6.28;
    this.retarget = 0;
    /* Pickups that turned out to be unreachable. Without this a body
       will stand under a crate on a deck it cannot climb for the rest
       of the run, which is exactly how the first autopilot runs died. */
    this.skip = new Map();
    this.chasing = null;
    this.chaseT = 0;
    this.backT = 0;      // how long we have been giving ground
    this.pushT = 0;      // ...and how long we are refusing to
    this.probeX = actor.x;
    this.probeT = 0;
  }

  /* ---------------- perception ---------------- */

  /* Nearest hostile this body can actually see and shoot. */
  Pilot.prototype.pickTarget = function (M) {
    const a = this.a;
    let best = null, bd = CFG.engageRange * CFG.engageRange;
    for (const e of M.enemies) {
      if (e.dead) continue;
      const ey = (e.kind === 'crawler' || e.kind === 'overlord') ? e.y : e.y - e.h * 0.5;
      const d = (e.x - a.x) * (e.x - a.x) + (ey - (a.y - a.h * 0.5)) * (ey - (a.y - a.h * 0.5));
      if (d > bd) continue;
      if (!M.world.canSee(a.x, a.y - a.h * 0.6, e.x, ey)) continue;
      // a boss outranks anything else in the room
      const score = d * (e.boss ? 0.25 : 1);
      if (score < bd) { bd = score; best = e; }
    }
    return best;
  };

  /* What this body is trying to reach. Allies follow, the player
     pushes for the exit, and both will divert for something worth
     picking up. */
  Pilot.prototype.pickGoal = function (M) {
    const a = this.a;
    if (this.o.follow) {
      const P = M.player;
      // hold a loose formation slot rather than standing on the player
      const side = this.o.slot || 1;
      return { x: P.x - side * 26, y: P.y, soft: true };
    }
    /* A warden it has not spoken to yet is worth a detour: a pilot that
       walks past every gift in the level is playing worse than a person
       would, and in a campaign those grafts are most of the run. */
    for (const W of M.wardens) {
      if (W.spent) continue;
      const d = Math.abs(W.x - a.x);
      if (d < 260 && W.x > a.x - 40) return { x: W.x, y: W.y, warden: W };
    }

    // something worth a detour, if it is roughly on the way
    let pick = null, pd = 150 * 150;
    for (const p of M.pickups) {
      if (p.taken || this.skip.has(p)) continue;
      const d = (p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y);
      if (d < pd && p.x > a.x - 60) { pd = d; pick = p; }
    }
    if (pick) return { x: pick.x, y: pick.y, pick: pick };
    return { x: M.exit.x, y: M.exit.y };
  };

  /* ---------------- terrain probing ---------------- */

  /* Is there floor under a point we could stand on? Deliberately looks
     a little ABOVE the feet as well: a deck one step up is somewhere
     you can walk on, and treating it as a hole makes the pilot
     bunny-hop the length of every terraced level and fling itself into
     the pits it was trying to clear. */
  Pilot.prototype.floorAt = function (M, x, y) {
    const g = M.world.groundUnder(x, y - CFG.stepUp, true);
    return g && g.y < y + 90 ? g : null;
  };

  /* How wide is the hole starting ahead of us, in the travel
     direction? Returns 0 when there is no hole, and records how far
     ahead the lip is in `this.holeAt` — the caller needs both, because
     a gap seen from 80px away is something to keep running at, and the
     same gap seen from 8px away is something to jump. Jumping on
     sight is how a body clears the lip and lands short of the far
     side, in the pit, every time. */
  Pilot.prototype.gapAhead = function (M, dir) {
    const a = this.a;
    const y = a.y - 2;
    let firstHole = -1;
    for (let d = 8; d <= 90; d += 5) {
      const x = a.x + dir * d;
      if (!this.floorAt(M, x, y)) { firstHole = d; break; }
    }
    this.holeAt = firstHole < 0 ? 999 : firstHole;
    if (firstHole < 0) return 0;
    for (let d = firstHole; d <= 130; d += 5) {
      const x = a.x + dir * d;
      const g = this.floorAt(M, x, y);
      if (g) return d - firstHole;          // width of the hole
    }
    return 999;                              // nothing on the far side within reach
  };

  /* Which way to run to get higher. A goal straight overhead gives no
     direction of its own, so look sideways for the nearest surface
     that is above us but still inside jump reach, and head for that.
     Returns 0 when nothing helps, which is the caller's cue to try
     jumping where it stands. */
  Pilot.prototype.climbDir = function (M, want) {
    const a = this.a;
    let bestDir = 0, bd = 1e9;
    for (const s of [1, -1]) {
      for (let d = 14; d <= CFG.ledgeScan; d += 8) {
        const x = a.x + s * d;
        // a surface strictly above the feet, and not so high we would
        // only bonk our head on its underside
        const g = M.world.groundUnder(x, a.y - CFG.climbReach, true);
        if (!g) continue;
        const rise = a.y - g.y;
        if (rise < 12 || rise > CFG.climbReach) continue;
        // only worth it if it closes the gap to where we want to be
        if (want !== undefined && g.y < want - 8) continue;
        const cost = d + Math.abs(g.y - (want === undefined ? g.y : want)) * 0.5;
        if (cost < bd) { bd = cost; bestDir = s; }
        break;
      }
    }
    return bestDir;
  };

  /* ---------------- the think ---------------- */
  Pilot.prototype.think = function (M, input, dt) {
    const a = this.a;
    input.left = input.right = input.up = input.down = false;
    input.jumpPressed = false;
    input.reloadPressed = false;
    input.fire = false;
    if (a.dead) return input;

    /* A box is up: hold still and read it. The mission advances the
       page off the pilot's behalf, so all this has to do is stop
       walking away mid-sentence. */
    if (M.dialog && M.dialog.open) {
      input.aimX = a.x + (a.face || 1) * 60;
      input.aimY = a.y - a.h * 0.5;
      input.cursorX = clamp(input.aimX - M.scroll, 0, LV.W);
      input.cursorY = clamp(input.aimY, 0, LV.H);
      return input;
    }

    this.react -= dt;
    this.retarget -= dt;
    this.jumpCool -= dt;
    if (this.unstickT > 0) this.unstickT -= dt;
    for (const [k, t] of this.skip) {
      if (t - dt <= 0) this.skip.delete(k); else this.skip.set(k, t - dt);
    }

    /* --- who to shoot --- */
    if (this.retarget <= 0 || !this.target || this.target.dead) {
      this.retarget = 0.25;
      this.target = this.pickTarget(M);
    }
    const T = this.target;

    /* --- where to go --- */
    this.goal = this.pickGoal(M);
    let dir = 0;
    const gx = this.goal.x;
    const dx = gx - a.x;
    if (Math.abs(dx) > CFG.arrive) dir = dx > 0 ? 1 : -1;
    // "the goal is above us" only counts as something to climb once we
    // are roughly under it; from across the level the ordinary
    // ledge-hopping gets us there without bunny-hopping the whole way.
    const wantUp = this.goal.y < a.y - CFG.climbUp && Math.abs(dx) < CFG.climbNear;

    /* Give up on a pickup we have been failing to reach. It is nearly
       always sitting on a deck two jumps above the floor we are on, and
       standing under it is not a plan. */
    if (this.goal.pick) {
      if (this.chasing !== this.goal.pick) { this.chasing = this.goal.pick; this.chaseT = 0; }
      this.chaseT += dt;
      if (this.chaseT > CFG.giveUpT) {
        this.skip.set(this.goal.pick, CFG.giveUpFor);
        this.chasing = null; this.chaseT = 0;
        this.goal = this.pickGoal(M);
        return this.think(M, input, 0);
      }
    } else { this.chasing = null; this.chaseT = 0; }

    /* Back off from something already on top of us, but never so far
       that the run stalls — a pilot that only retreats never finishes
       the level. */
    if (this.pushT > 0) this.pushT -= dt;
    if (T && !this.o.follow && this.pushT <= 0) {
      const td = Math.abs(T.x - a.x);
      // Something a deck above us is not in our face, whatever the
      // horizontal distance says — and treating it as one is how the
      // pilot ends up pacing under a grunt it cannot reach.
      const level = Math.abs(T.y - a.y) < CFG.faceBand;
      const near = td < CFG.dangerRange && level;
      if (near && Math.sign(T.x - a.x) === dir) dir = -dir;
      // Count the whole time the threat is on top of us, not just the
      // frames we happen to be walking into it: backing off and closing
      // again is a limit cycle, and a timer that decays on the closing
      // half never trips.
      if (near) {
        this.backT += dt;
        if (this.backT > CFG.backMax) { this.backT = 0; this.pushT = CFG.pushFor; }
      } else this.backT = Math.max(0, this.backT - dt * 0.5);
    } else this.backT = 0;

    /* --- stuck detection ---
       Measured over a window rather than frame to frame. A body pinned
       against a wall and a body oscillating across the same two pixels
       are equally stuck, and only a window sees the second one. */
    this.probeT += dt;
    if (this.probeT >= CFG.probeWindow) {
      if (Math.abs(a.x - this.probeX) < CFG.probeMove) this.stuck += this.probeT;
      else this.stuck = 0;
      this.probeX = a.x; this.probeT = 0;
    }
    this.lastX = a.x;
    if (this.stuck > CFG.stuckTime && this.unstickT <= 0) {
      // shove sideways and jump, and stop giving ground for a moment:
      // almost everything that traps a body here is either a lip it can
      // hop or a standoff it has to walk through
      this.unstickDir = dir || 1;
      this.unstickT = 0.5;
      this.stuck = 0;
      this.pushT = CFG.pushFor;
      this.jumpCool = 0;
    }
    if (this.unstickT > 0) {
      dir = this.unstickDir;
      if (a.ground && this.jumpCool <= 0) { input.jumpPressed = true; this.jumpCool = 0.25; }
    }

    /* --- terrain: jump pits, hop ledges, climb, drop through decks ---
       This runs whether or not we have a horizontal direction. A goal
       directly overhead leaves `dir` at zero, and gating the jumps on
       `dir` is how a body ends up standing forever under the deck it
       was trying to reach. */
    if (this.unstickT <= 0) {
      const gap = dir !== 0 ? this.gapAhead(M, dir) : 0;
      const probe = dir || (a.face || 1);
      const wall = dir !== 0 && M.world.solidAt(a.x + dir * (a.w * 0.5 + 4), a.y - 8, false);
      const stepUp = dir !== 0 && M.world.solidAt(a.x + dir * (a.w * 0.5 + 4), a.y - 3, false);

      if (a.ground && this.jumpCool <= 0) {
        if (dir !== 0 && gap > 6 && this.holeAt <= CFG.edge) {
          input.jumpPressed = true; this.jumpCool = 0.3;
        }
        else if (wall || stepUp) { input.jumpPressed = true; this.jumpCool = 0.3; }
        else if (wantUp) {
          // Straight up if the deck is over our head, otherwise run at
          // the nearest thing we can climb and jump on the way.
          const c = Math.abs(dx) < 40 ? this.climbDir(M, this.goal.y) : dir;
          if (c !== 0 && Math.abs(dx) < 40) { dir = c; }
          input.jumpPressed = true; this.jumpCool = 0.35;
        }
      } else if (!a.ground && a.airJumps > 0) {
        const below = this.floorAt(M, a.x, a.y);
        const ahead = this.floorAt(M, a.x + probe * 14, a.y);
        if (a.vy > 0.4 && a.hitWall) {
          // Sliding down the face of a ledge we undershot. Spend the
          // air jump NOW — deliberately ignoring the cooldown, because
          // every frame of the slide is height we will not get back and
          // riding it down is how a run ends in the pit at the foot of
          // the wall.
          input.jumpPressed = true; this.jumpCool = 0.3;
        } else if (this.jumpCool > 0) {
          /* still on cooldown for the non-urgent cases */
        } else if (a.vy > 0.6 && !below && (!ahead || gap > CFG.gapJump)) {
          // falling into a pit: spend the air jump to clear it
          input.jumpPressed = true; this.jumpCool = 0.3;
        } else if (wantUp && a.vy > -1.4 && (a.y - this.goal.y) > 30) {
          // rising has run out and we are still short of the deck
          input.jumpPressed = true; this.jumpCool = 0.3;
        }
      }
      /* Drop through a one-way deck when the goal is under us — but
         only when we are nearly over the goal AND there is something to
         land on. A deck runs above pits as often as it runs above
         floor, and dropping off one because the exit happens to be
         lower than the deck is a long fall onto nothing. */
      if (a.ground && a.standingOn && !a.standingOn.ground &&
          this.goal.y > a.y + 24 && Math.abs(dx) < CFG.dropNear &&
          this.jumpCool <= 0) {
        const land = M.world.groundUnder(a.x, a.y + 8, true);
        if (land && land.y - a.y < CFG.dropDrop) {
          input.down = true; input.jumpPressed = true; this.jumpCool = 0.35;
        }
      }
    }

    // `dir` can be reset by the climb probe above, so commit it here
    input.left = dir < 0; input.right = dir > 0;

    /* --- aim and fire --- */
    this.aimNoise += dt * 3.1;
    if (T) {
      const ty = (T.kind === 'crawler' || T.kind === 'overlord') ? T.y : T.y - T.h * 0.5;
      // lead the shot by how long the round takes to arrive
      const w = a.weapon && a.weapon.def ? a.weapon.def : { speed: 7 };
      const dist = Math.hypot(T.x - a.x, ty - (a.y - a.h * 0.5));
      const t = dist / Math.max(1, w.speed) * CFG.leadFactor;
      const lx = T.x + (T.vx || 0) * t;
      const ly = ty + (T.vy || 0) * t;
      const j = Math.sin(this.aimNoise) * CFG.aimJitter * dist;
      input.aimX = lx;
      input.aimY = ly + j;
      // a reaction delay, so it does not snap onto a target the instant
      // it appears — the difference between an opponent and a turret
      if (this.react <= 0) {
        input.fire = M.world.canSee(a.x, a.y - a.h * 0.6, T.x, ty);
      }
      if (this.react <= -1) this.react = CFG.reactMin + Math.random() * (CFG.reactMax - CFG.reactMin);
    } else {
      // nothing to shoot: look where it is going
      input.aimX = a.x + (dir || (a.face || 1)) * 60;
      input.aimY = a.y - a.h * 0.5;
      if (this.react <= 0) this.react = CFG.reactMin + Math.random() * (CFG.reactMax - CFG.reactMin);
    }

    /* --- reload when it is quiet --- */
    const W = a.weapon;
    if (W && W.reloading <= 0 && W.ammo <= 0) input.reloadPressed = true;
    else if (W && W.reloading <= 0 && !T && W.ammo < W.def.mag * 0.35) input.reloadPressed = true;

    // the mouse-space fields the player path uses
    input.cursorX = clamp(input.aimX - M.scroll, 0, LV.W);
    input.cursorY = clamp(input.aimY, 0, LV.H);
    return input;
  };

  return { Pilot, CFG };
})();
