/* ============================================================
   dialog.js — the old-school RPG text box.

   A queue of pages, revealed a character at a time, waiting on a
   keypress between them. That is the whole machine, and keeping it a
   plain state object rather than a screen means it can run over live
   gameplay: the mission keeps stepping behind the box, the player is
   just held still while a warden talks.

   The reveal is driven by elapsed time rather than frames so it reads
   the same on any refresh rate, and holding the advance key runs it
   out early — the one thing every text box in this style gets asked
   for and the one thing they usually get wrong.
   ============================================================ */
window.DIALOG = (function () {
  "use strict";

  const CPS = 42;              // characters per second
  const CPS_FAST = 260;        // ...while the advance key is held
  const HOLD = 0.22;           // ignore input for this long after a page opens

  function Dialog() {
    this.open = false;
    this.pages = [];
    this.page = 0;
    this.shown = 0;            // characters revealed on the current page
    this.hold = 0;
    this.speaker = null;
    this.tint = '#8cf';
    this.portrait = null;      // a rig to draw in the corner box
    this.onClose = null;
    this.t = 0;
    this.blip = 0;
  }

  /* Start a conversation. Anything already up is replaced — a warden
     you walk into mid-sentence is the newer thing to have happened. */
  Dialog.prototype.say = function (pages, opts) {
    const o = opts || {};
    this.pages = Array.isArray(pages) ? pages.slice() : [String(pages)];
    if (!this.pages.length) return false;
    this.open = true;
    this.page = 0;
    this.shown = 0;
    this.hold = HOLD;
    this.t = 0;
    this.speaker = o.speaker || null;
    this.tint = o.tint || '#8cf';
    this.portrait = o.portrait || null;
    this.onClose = o.onClose || null;
    return true;
  };

  Dialog.prototype.text = function () {
    return this.pages[this.page] || '';
  };

  Dialog.prototype.full = function () {
    return this.shown >= this.text().length;
  };

  /* Returns true while it is holding the game. `advance` is the edge of
     whatever key or button the player uses; `held` is that key still
     being down, which runs the reveal out fast. */
  Dialog.prototype.step = function (dt, advance, held) {
    if (!this.open) return false;
    this.t += dt;
    if (this.hold > 0) this.hold -= dt;

    const before = this.shown;
    const len = this.text().length;
    if (this.shown < len) {
      this.shown = Math.min(len, this.shown + (held ? CPS_FAST : CPS) * dt);
      // one blip per few characters, so it chatters rather than buzzes
      if (Math.floor(this.shown / 3) !== Math.floor(before / 3)) this.blip = 1;
    }
    if (this.blip > 0) this.blip = Math.max(0, this.blip - dt * 6);

    if (advance && this.hold <= 0) {
      if (this.shown < len) {
        this.shown = len;                 // first press fills the page
      } else if (this.page < this.pages.length - 1) {
        this.page++; this.shown = 0; this.hold = HOLD;
      } else {
        this.close();
      }
    }
    return this.open;
  };

  Dialog.prototype.close = function () {
    this.open = false;
    const cb = this.onClose;
    this.onClose = null;
    this.pages = [];
    if (cb) cb();
  };

  /* ============================================================
     What the wardens say.

     Cryptic on purpose, and generated rather than written out, so the
     hundredth run still says something you have not read. A line is
     built from an opening, a middle and a turn; the pieces are chosen
     so that almost every combination reads like a warning from
     somebody who has been here much longer than you have.
     ============================================================ */
  const OPEN = [
    'THE FLOOR REMEMBERS EVERY STEP TAKEN ON IT.',
    'I COUNTED THE LIGHTS. ONE OF THEM COUNTS BACK.',
    'YOU ARE NOT THE FIRST TO COME THIS WAY WEARING THAT FACE.',
    'THERE IS A SOUND UNDER THE MACHINES. DO NOT LEARN IT.',
    'THEY BUILT DOWNWARD BECAUSE SOMETHING ASKED THEM TO.',
    'EVERY DOOR HERE OPENS TWICE. ONCE FOR YOU.',
    'THE RUST IS NOT RUST. IT IS PATIENT.',
    'I HAVE BEEN STANDING HERE SINCE BEFORE THE POWER.',
    'SOMETHING WALKED OUT OF THE VATS AND SIGNED FOR THIS SECTOR.',
    'THE ARCHITECTS LEFT. THEIR DRAWINGS DID NOT.',
    'YOUR SHADOW ARRIVED SOME TIME AGO. IT WAS QUIETER.',
    'THIS DEEP, THE AIR HAS OPINIONS.',
    'I WAS TOLD TO WAIT. I WAS NOT TOLD FOR WHOM.',
    'THE MERCY OF THIS PLACE IS THAT IT IS HONEST.',
    'THERE ARE TWENTY FLOORS BELOW THIS ONE. NINETEEN ARE SEALED.'
  ];
  const MIDDLE = [
    'TAKE THIS. IT WAS NOT MINE EITHER.',
    'HOLD OUT YOUR HANDS. DO NOT LOOK AT THEM.',
    'I KEPT THIS BACK FROM THE LAST ONE. THEY DID NOT NEED IT LONG.',
    'IT WILL SERVE. IT HAS SERVED.',
    'THIS WAS PULLED OUT OF SOMETHING THAT WAS STILL MOVING.',
    'THE PREVIOUS OWNER WAS VERY GRATEFUL. BRIEFLY.',
    'IT IS WARM. IT SHOULD NOT BE WARM.',
    'I HAVE CARRIED THIS SO LONG IT HAS STARTED CARRYING ME.',
    'A GIFT. THE WORD IS DOING A GREAT DEAL OF WORK.',
    'TAKE IT BEFORE I REMEMBER WHY I KEPT IT.'
  ];
  const TURN = [
    'GO EAST. DO NOT ACKNOWLEDGE THE LIGHTS.',
    'WHEN IT SPEAKS IN YOUR VOICE, KEEP WALKING.',
    'THE THING AHEAD IS NOT GUARDING. IT IS WAITING.',
    'IF THE FLOOR IS WET, IT IS AWAKE.',
    'DO NOT COUNT THE BODIES. THE NUMBER CHANGES.',
    'YOU WILL HEAR ME AGAIN. I WILL NOT BE HERE.',
    'THE EXIT IS REAL. THAT IS ALL I WILL PROMISE.',
    'SOMETHING BELOW HAS LEARNED YOUR NAME. IT IS PRACTISING.',
    'KILL WHAT MOVES SLOWLY. THE FAST ONES ARE ALREADY DEAD.',
    'WHEN THE LIGHTS GO AMBER, STOP BREATHING.',
    'THERE IS NO SECOND WARNING. THIS WAS THE FIRST.',
    'THE DEEPER SECTORS ARE NOT WORSE. THEY ARE MORE HONEST.'
  ];
  /* Said instead of the gift line once the warden has nothing left. */
  const EMPTY = [
    'I HAVE NOTHING ELSE. I AM NOT SURE I HAD THAT.',
    'MY HANDS ARE EMPTY AND I DO NOT REMEMBER OPENING THEM.',
    'YOU HAVE HAD WHAT I WAS HOLDING. GO.',
    'THERE IS NOTHING FURTHER. THERE RARELY IS.'
  ];

  /* ============================================================
     WHAT A PERSON SAYS.

     The pool above is a warden: a figure who has been standing in the
     dark for a century and is nobody in particular. In a story run the
     figure in the alcove is SOMEBODY — a defector out of the garrison
     upstairs, a survivor of a floor you have already walked, somebody
     a faction you did a favour for has sent to find you — and what
     they say has to come out of that rather than out of the same bag
     of portents.

     Same shape as `lines()`: an opening, the gift, and a turn. What
     changes is that every clause here has a slot in it, so the line is
     about this world and this run rather than about the dark.
     ============================================================ */
  const ROLES = {
    defector: {
      label: 'DEFECTOR',
      open: [
        'I WORE THEIR COLOURS FOR ELEVEN YEARS. %F. ASK ME ANYTHING.',
        'I AM NOT WITH %F. I WAS. THERE IS PAPERWORK.',
        'THEY WILL TELL YOU I DESERTED. I WAS DISMISSED, IN A WAY.',
        'EVERYTHING ABOVE US IS %F AND EVERYTHING ABOVE US IS WRONG.',
        'I SIGNED FOR THIS FLOOR. THEN I READ WHAT I HAD SIGNED.'
      ],
      turn: [
        'THEY HOLD THE HIGH GROUND AND THEY EXPECT YOU TO TAKE IT.',
        'DO NOT FIGHT THEM WHERE THEY ARE STANDING. THEY CHOSE IT.',
        '%F COUNT THEIR DEAD. THEY WILL COUNT YOU BEFORE YOU ARE ONE.',
        'THERE IS A WAY UP THAT IS NOT ON THEIR ROSTER. YOU WILL FIND IT.',
        'WHEN YOU MEET THEIR OFFICER, DO NOT LET THEM TALK.'
      ]
    },
    survivor: {
      label: 'SURVIVOR',
      open: [
        'I CAME OUT OF %P. NOT ALL OF ME.',
        'YOU HAVE BEEN TO %P. I CAN SEE IT ON YOU.',
        'THERE WERE NINE OF US IN %P. THE NUMBER HAS NOT MOVED SINCE.',
        'I HAVE BEEN WALKING SINCE %P AND I HAVE NOT ARRIVED.',
        'THEY SEALED %P WITH ME ON THE WRONG SIDE OF IT.'
      ],
      turn: [
        'IT DOES NOT GET DEEPER. IT GETS MORE HONEST.',
        'IF YOU HEAR YOUR OWN STEP COMING BACK, STOP WALKING.',
        'I WILL NOT COME WITH YOU. I HAVE BEEN AHEAD OF YOU ALREADY.',
        'WHATEVER IS UNDER THIS FLOOR WAS UNDER THAT ONE TOO.',
        'GO. AND DO NOT COME BACK THROUGH HERE.'
      ]
    },
    creditor: {
      label: 'CREDITOR',
      open: [
        '%F SENT ME. THAT SENTENCE IS DOING A LOT OF WORK.',
        'YOU DID SOMETHING FOR %F AND THEY HAVE NOT FORGOTTEN IT.',
        'I AM HERE BECAUSE SOMEBODY ABOVE ME OWES YOU AND WILL NOT SAY SO.',
        '%F PAY THEIR DEBTS. IT IS THE ONLY THING THEY ARE GOOD AT.',
        'THIS IS NOT CHARITY. IT IS BOOKKEEPING.'
      ],
      turn: [
        'WE ARE SQUARE. DO NOT MAKE ME COME OUT HERE AGAIN.',
        'THEY WILL WANT SOMETHING BACK EVENTUALLY. THEY ALWAYS DO.',
        'IF ANYONE ASKS, I WAS NEVER ON THIS FLOOR.',
        'KEEP DOING WHATEVER IT IS. IT IS WORKING.',
        'THE ACCOUNT IS OPEN AGAIN. THAT IS THE WHOLE MESSAGE.'
      ]
    },
    archivist: {
      label: 'ARCHIVIST',
      open: [
        'I HAVE BEEN CATALOGUING %X SINCE BEFORE IT HAD A NAME.',
        'YOU ARE LOOKING FOR %X. EVERYONE IS. NOBODY READS THE ENTRY.',
        '%X IS FILED UNDER SOMETHING THAT IS NO LONGER A DEPARTMENT.',
        'THERE ARE FOUR ACCOUNTS OF %X AND THEY DISAGREE ON EVERYTHING.',
        'I KEPT THE RECORD. THE RECORD IS ALL THERE IS LEFT TO KEEP.'
      ],
      turn: [
        '%X IS NOT A THING YOU TAKE. IT IS A THING THAT TAKES A HOLDER.',
        'THE ENTRY ENDS MID-SENTENCE. I DID NOT DO THAT.',
        'WHOEVER TOLD YOU WHAT IT IS HAS NOT READ THE FILE EITHER.',
        'GO AND SEE. THEN COME BACK AND CORRECT ME.',
        'I WILL AMEND THE RECORD WHEN I HEAR WHAT HAPPENED TO YOU.'
      ]
    },
    grudge: {
      label: 'THE AGGRIEVED',
      open: [
        'I KNOW WHAT YOU DID IN %P.',
        'YOU HAVE COST %F MORE THAN THEY WILL PUT IN WRITING.',
        'I WAS TOLD TO WAIT HERE AND HATE YOU. I HAVE MANAGED HALF OF IT.',
        'THERE IS A NUMBER ON YOU NOW. I HELPED SET IT.',
        'I AM NOT GOING TO STOP YOU. I WANTED TO SEE THE FACE.'
      ],
      turn: [
        'THEY ARE AHEAD OF YOU AND THEY ARE EXPECTING SOMEBODY.',
        'TAKE IT. IT IS NOT A GIFT, IT IS A WITNESS STATEMENT.',
        'WHEN THIS IS OVER, SOMEBODY WILL COME AND ASK ME ABOUT YOU.',
        'I HOPE IT IS WORTH WHAT IT HAS ALREADY COST.',
        'GO ON THEN. I HAVE SEEN ENOUGH.'
      ]
    }
  };
  const ROLE_KEYS = Object.keys(ROLES);

  /* `who` is the person, `ctx` supplies the slots, `gift` is what they
     are holding. Deterministic in the run's rng exactly as `lines()`
     is, so the same seed meets the same person saying the same thing. */
  function storyLines(rng, role, ctx, gift, spent) {
    const R = ROLES[role] || ROLES.survivor;
    const fill = t => String(t)
      .replace(/%F/g, (ctx && ctx.faction) || 'THEM')
      .replace(/%P/g, (ctx && ctx.place) || 'THE SITE')
      .replace(/%X/g, (ctx && ctx.artifact) || 'THE THING')
      .replace(/%Y/g, (ctx && ctx.you) || 'YOU');
    const pick = a => fill(a[rng.int(0, a.length - 1)]);
    const out = [pick(R.open)];
    if (spent) out.push(fill(EMPTY[rng.int(0, EMPTY.length - 1)]));
    else out.push(pick(MIDDLE) + '\n\n' + (gift && gift.line ? gift.line : ''));
    out.push(pick(R.turn));
    return out;
  }

  /* Build a conversation. Deterministic in the run's rng, so the same
     seed always meets the same warden saying the same thing. */
  function lines(rng, gift, spent) {
    const pick = a => a[rng.int(0, a.length - 1)];
    const out = [pick(OPEN)];
    if (spent) out.push(pick(EMPTY));
    else out.push(pick(MIDDLE) + '\n\n' + (gift && gift.line ? gift.line : ''));
    out.push(pick(TURN));
    return out;
  }

  return { Dialog, lines, storyLines, ROLES, ROLE_KEYS,
           OPEN, MIDDLE, TURN, EMPTY, CPS, CPS_FAST };
})();
