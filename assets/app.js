/* Lucky Loop — game engine
   Plain ES2017. No dependencies, no network calls. */

(() => {
  "use strict";

  const SYMBOLS = {
    cherry:  { payout: 8,   name: "cherries", label: "cherry" },
    star:    { payout: 12,  name: "stars",    label: "star" },
    clover:  { payout: 20,  name: "clovers",  label: "clover" },
    bell:    { payout: 40,  name: "bells",    label: "bell" },
    diamond: { payout: 100, name: "diamonds", label: "diamond" },
    seven:   { payout: 200, name: "sevens",   label: "seven" }
  };

  /* 24 stops per reel: 6 cherries, 5 stars, 4 clovers, 4 bells, 3 diamonds, 2 sevens. */
  const STRIP = [
    "cherry", "cherry", "star", "bell", "cherry", "clover",
    "diamond", "cherry", "star", "seven", "clover", "bell",
    "cherry", "star", "diamond", "clover", "bell", "cherry",
    "star", "seven", "diamond", "clover", "bell", "star"
  ];

  const BETS = [1, 5, 10, 25];
  const START_CREDITS = 1000;
  const STORAGE_KEY = "luckyLoop.v1";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const creditsFormat = new Intl.NumberFormat("en-US");
  const secureRandomAvailable = Boolean(window.crypto && typeof window.crypto.getRandomValues === "function");

  const state = {
    credits: START_CREDITS,
    bet: 5,
    sound: false,
    spinning: false
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    machine: $("machine"),
    reels: Array.from(document.querySelectorAll(".reel")).map((root) => ({
      root,
      strip: root.querySelector(".reel-strip")
    })),
    credits: $("credits"),
    bet: $("bet"),
    betDown: $("bet-down"),
    betUp: $("bet-up"),
    spin: $("spin"),
    spinLabel: document.querySelector("#spin .spin-label"),
    spinSub: $("spin-sub"),
    sound: $("sound"),
    soundState: $("sound-state"),
    reset: $("reset"),
    result: $("result")
  };

  /* ---------- Persistence ---------- */

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && typeof saved === "object") {
        if (Number.isFinite(saved.credits)) {
          state.credits = Math.max(0, Math.min(99999999, Math.floor(saved.credits)));
        }
        if (BETS.includes(saved.bet)) state.bet = saved.bet;
        state.sound = saved.sound === true;
      }
    }
  } catch (error) {
    /* Storage can be unavailable in private modes; the game still works. */
  }

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        credits: state.credits,
        bet: state.bet,
        sound: state.sound
      }));
    } catch (error) {
      /* Ignore write failures. */
    }
  }

  /* ---------- Fair randomness ---------- */

  function randomBelow(max) {
    const range = 0x100000000;
    const limit = Math.floor(range / max) * max;
    const buffer = new Uint32Array(1);
    let value;
    do {
      window.crypto.getRandomValues(buffer);
      value = buffer[0];
    } while (value >= limit);
    return value % max;
  }

  function randomSymbol() {
    return STRIP[randomBelow(STRIP.length)];
  }

  /* ---------- Rendering ---------- */

  const symbolMarkup = (name) =>
    `<svg class="sym sym-${name}" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><use href="#sym-${name}"></use></svg>`;

  const cellMarkup = (name) => `<div class="reel-cell">${symbolMarkup(name)}</div>`;

  function pluralCredits(n) {
    return `${creditsFormat.format(n)} credit${n === 1 ? "" : "s"}`;
  }

  function setResult(message, kind) {
    els.result.textContent = message;
    els.result.classList.toggle("is-win", kind === "win");
    els.result.classList.toggle("is-alert", kind === "alert");
  }

  function bump(element) {
    if (reduceMotion.matches) return;
    element.classList.remove("is-bumping");
    void element.offsetWidth;
    element.classList.add("is-bumping");
    window.setTimeout(() => element.classList.remove("is-bumping"), 400);
  }

  function render() {
    const betIndex = BETS.indexOf(state.bet);
    const canSpin = !state.spinning && state.credits >= state.bet && secureRandomAvailable;

    els.credits.textContent = creditsFormat.format(state.credits);
    els.bet.textContent = String(state.bet);
    els.spin.disabled = !canSpin;
    els.spin.classList.toggle("is-spinning", state.spinning);
    els.betDown.disabled = state.spinning || betIndex <= 0;
    els.betUp.disabled = state.spinning || betIndex >= BETS.length - 1;
    els.reset.disabled = state.spinning;

    if (state.spinning) {
      els.spinLabel.textContent = "Spinning";
      els.spinSub.textContent = "good luck";
      els.spin.setAttribute("aria-label", "Spinning the reels");
    } else if (!secureRandomAvailable) {
      els.spinLabel.textContent = "Unavailable";
      els.spinSub.textContent = "browser not supported";
      els.spin.setAttribute("aria-label", "Spin unavailable in this browser");
    } else if (state.credits < state.bet) {
      els.spinLabel.textContent = "Spin";
      els.spinSub.textContent = "reset credits first";
      els.spin.setAttribute("aria-label", "Spin unavailable — not enough credits");
    } else {
      els.spinLabel.textContent = "Spin";
      els.spinSub.textContent = `for ${pluralCredits(state.bet)}`;
      els.spin.setAttribute("aria-label", `Spin for ${pluralCredits(state.bet)}`);
    }
  }

  function renderSound() {
    els.sound.setAttribute("aria-pressed", String(state.sound));
    els.sound.setAttribute("aria-label", state.sound ? "Sound effects on" : "Sound effects off");
    els.soundState.textContent = state.sound ? "On" : "Off";
  }

  /* ---------- Audio (synthesised, no files) ---------- */

  let audioContext = null;

  function ensureAudio() {
    if (!state.sound) return null;
    try {
      if (!audioContext) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return null;
        audioContext = new AudioCtor();
      }
      if (audioContext.state === "suspended") audioContext.resume();
      return audioContext;
    } catch (error) {
      return null;
    }
  }

  function tone(frequency, duration, type, gainValue, delay) {
    if (!state.sound) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const start = ctx.currentTime + (delay || 0);
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type || "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue || 0.03, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function playStart() {
    tone(196, 0.1, "triangle", 0.022);
    tone(262, 0.12, "triangle", 0.018, 0.06);
  }

  function playStop(index) {
    tone(340 + index * 36, 0.055, "triangle", 0.024);
  }

  function playWin(jackpot) {
    const notes = jackpot ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [523.25, 659.25, 783.99];
    notes.forEach((frequency, index) => {
      tone(frequency, 0.22, "sine", 0.035, index * 0.085);
    });
  }

  function playLose() {
    tone(174, 0.1, "sine", 0.016);
  }

  /* ---------- Game flow ---------- */

  function evaluate(symbols) {
    const [a, b, c] = symbols;
    if (a === b && b === c) return SYMBOLS[a].payout;
    const cherries = symbols.filter((symbol) => symbol === "cherry").length;
    return cherries === 2 ? 1 : 0;
  }

  function winMessage(symbols, multiplier, amount) {
    const [a, b, c] = symbols;
    if (a === b && b === c) {
      const label = SYMBOLS[a].name;
      const prefix = a === "seven" ? "Jackpot — three sevens!" : `Three ${label}!`;
      return `${prefix} You win ${pluralCredits(amount)} (${multiplier}× bet).`;
    }
    return `Two cherries! You win ${pluralCredits(amount)} (${multiplier}× bet).`;
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function spin() {
    if (state.spinning || !secureRandomAvailable) return;
    if (state.credits < state.bet) {
      setResult(`You need ${pluralCredits(state.bet)} to spin. Choose Reset credits to start again.`, "alert");
      return;
    }

    state.spinning = true;
    state.credits -= state.bet;
    save();
    render();

    els.machine.setAttribute("aria-busy", "true");
    els.machine.classList.remove("is-win");
    els.reels.forEach(({ root }) => root.classList.remove("is-win"));
    setResult("Spinning…");
    playStart();

    const outcome = [randomSymbol(), randomSymbol(), randomSymbol()];
    const durations = reduceMotion.matches ? [0, 0, 0] : [1150, 1420, 1720];

    els.reels.forEach((reel, index) => {
      const filler = Array.from({ length: 14 }, randomSymbol);
      const triple = [randomSymbol(), outcome[index], randomSymbol()];

      reel.strip.style.transition = "none";
      reel.strip.style.setProperty("--stop", "0");
      reel.strip.innerHTML = filler.concat(triple).map(cellMarkup).join("");
      reel.root.classList.remove("is-win");
      void reel.strip.offsetHeight;

      const stopIndex = filler.length;

      if (durations[index] === 0) {
        reel.strip.style.setProperty("--stop", String(stopIndex));
        playStop(index);
        return;
      }

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          reel.strip.style.transition = `transform ${durations[index]}ms cubic-bezier(0.16, 0.72, 0.16, 1)`;
          reel.strip.style.setProperty("--stop", String(stopIndex));
        });
      });

      window.setTimeout(() => playStop(index), durations[index] + 20);
    });

    await wait(Math.max(...durations) + 140);

    const multiplier = evaluate(outcome);
    const winAmount = multiplier * state.bet;

    if (winAmount > 0) {
      state.credits += winAmount;
      els.reels.forEach(({ root }) => root.classList.add("is-win"));
      els.machine.classList.add("is-win");
      window.setTimeout(() => els.machine.classList.remove("is-win"), 1000);
      setResult(winMessage(outcome, multiplier, winAmount), "win");
      playWin(multiplier >= 8);
      bump(els.credits);
    } else if (state.credits < state.bet) {
      setResult(`No win this spin. You have ${pluralCredits(state.credits)} left — reset credits to keep playing.`, "alert");
      playLose();
    } else {
      setResult("No win this spin. The reels are independent — try again when you’re ready.");
      playLose();
    }

    state.spinning = false;
    els.machine.removeAttribute("aria-busy");
    save();
    render();
  }

  function changeBet(direction) {
    if (state.spinning) return;
    const currentIndex = BETS.indexOf(state.bet);
    const nextIndex = Math.max(0, Math.min(BETS.length - 1, currentIndex + direction));
    const nextBet = BETS[nextIndex];
    if (nextBet === state.bet) return;

    state.bet = nextBet;
    save();
    render();

    if (state.credits < state.bet) {
      setResult(`Bet set to ${pluralCredits(state.bet)}, but you only have ${pluralCredits(state.credits)}. Reset credits to keep playing.`, "alert");
    } else {
      setResult(`Bet set to ${pluralCredits(state.bet)}.`);
    }
  }

  function resetCredits() {
    if (state.spinning) return;
    state.credits = START_CREDITS;
    save();
    render();
    setResult(`Credits reset to ${creditsFormat.format(START_CREDITS)}. Good luck.`);
    tone(392, 0.09, "sine", 0.025);
    tone(523.25, 0.12, "sine", 0.025, 0.08);
  }

  function toggleSound() {
    state.sound = !state.sound;
    save();
    renderSound();
    if (state.sound) {
      ensureAudio();
      tone(523.25, 0.08, "sine", 0.025);
      tone(659.25, 0.1, "sine", 0.025, 0.07);
    }
  }

  /* ---------- Events ---------- */

  els.spin.addEventListener("click", spin);
  els.betDown.addEventListener("click", () => changeBet(-1));
  els.betUp.addEventListener("click", () => changeBet(1));
  els.sound.addEventListener("click", toggleSound);
  els.reset.addEventListener("click", resetCredits);

  /* ---------- Initial state ---------- */

  render();
  renderSound();

  if (!secureRandomAvailable) {
    setResult("This browser cannot generate secure random spins. Please try a current version of Chrome, Safari, Firefox, or Edge.", "alert");
  } else if (state.credits < state.bet) {
    setResult(`You have ${pluralCredits(state.credits)}. Reset credits to keep playing.`, "alert");
  }
})();
