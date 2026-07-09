/**
 * EngineSim — combustion drivetrain model driven by a single input: speed.
 *
 * From speed it derives:
 *   - gear   (automatic gearbox with shift-up / shift-down RPM thresholds
 *             and hysteresis, plus a shift duration during which torque
 *             is cut, like a real automatic/sequential box)
 *   - rpm    (proportional to speed through the current gear ratio,
 *             clamped to idle — torque converter / clutch slip at low speed)
 *   - throttle/load (estimated from acceleration, drives sound character)
 */
class EngineSim {
  constructor(config) {
    this.configure(config);
    this.reset();
  }

  configure(config) {
    this.cfg = Object.assign(
      {
        maxRpm: 7000, // rev limiter
        idleRpm: 850,
        maxSpeed: 250, // km/h at maxRpm in top gear
        gears: 6,
        shiftUpRpm: 6200, // upshift threshold under acceleration
        shiftDownRpm: 1800, // downshift threshold
        shiftTime: 0.3, // seconds of torque cut while shifting
        firstGearFrac: 0.19, // fraction of maxSpeed reachable in 1st gear
        revUpTime: 0.55, // neutral free-rev: time constant climbing (s)
        revDownTime: 0.85, // neutral free-rev: time constant falling (s)
        speedSmoothing: 0.3, // s: how hard the displayed speed chases the input
        // (small = snappy, less lag behind GPS; large = smooth over sparse fixes)
      },
      config,
    );
    this._computeGearing();
    // Reconfiguring mid-drive: the current gear must exist in the new box
    if (this.gear !== undefined && this.gear > this.cfg.gears) {
      this.gear = this.cfg.gears;
    }
  }

  /**
   * Gear spacing expressed as the road speed each gear reaches at
   * maxRpm. Real gearboxes space these nearly linearly — big RPM drops
   * between the low gears, small ones between the high gears — unlike
   * geometric spacing, which makes mid gears far too short and revs
   * everything like a race car at city speeds.
   */
  _computeGearing() {
    const { gears, maxSpeed, firstGearFrac } = this.cfg;
    this.gearTopSpeed = [];
    if (gears === 1) {
      this.gearTopSpeed.push(maxSpeed);
      return;
    }
    for (let i = 0; i < gears; i++) {
      this.gearTopSpeed.push(
        maxSpeed * (firstGearFrac + (1 - firstGearFrac) * (i / (gears - 1))),
      );
    }
  }

  reset() {
    this.speed = 0; // km/h (smoothed actual)
    this.targetSpeed = 0; // km/h (raw input)
    this.gear = 1; // 1-based
    this.rpm = this.cfg.idleRpm;
    this.throttle = 0; // 0..1 estimated engine load
    this.accel = 0; // km/h per second (smoothed)
    this.shiftTimer = 0; // >0 while a shift is in progress
    this.shiftDir = 0; // +1 up, -1 down
    this.aggressiveness = 0; // 0 relaxed .. 1 sporty (driver style estimate)
    this.braking = false; // true under hard deceleration
    this.kickdownInhibit = 0; // no kickdown right after an upshift (no hunting)
    this.limiting = false; // latched rev-limiter state (hysteresis)
    this.limiterPhase = 0; // rev-limiter flutter phase
    this.sparkCut = false; // true during a limiter fuel-cut frame
    this.neutral = false; // true = drivetrain disconnected (free rev)
    this.revDemand = 0; // 0..1 accelerator position while in neutral
  }

  /**
   * Engage/disengage neutral. In neutral the engine free-revs from
   * `revDemand` and the wheels are disconnected. Re-engaging drive
   * picks the highest gear that doesn't lug at the current speed.
   */
  setNeutral(on) {
    on = !!on;
    if (this.neutral === on) return;
    this.neutral = on;
    if (!on) {
      let g = 1;
      for (let i = this.cfg.gears; i >= 1; i--) {
        if (this.rpmInGear(this.speed, i - 1) >= this.cfg.shiftDownRpm * 1.2) {
          g = i;
          break;
        }
      }
      this.gear = g;
    }
  }

  /** Accelerator position (0..1) used to rev the engine while in neutral. */
  setRevDemand(x) {
    this.revDemand = Math.max(0, Math.min(1, x));
  }

  /** RPM the engine would turn at `speed` in gear index `g` (0-based). */
  rpmInGear(speed, g) {
    const raw = (speed / this.gearTopSpeed[g]) * this.cfg.maxRpm;
    return Math.max(this.cfg.idleRpm, Math.min(raw, this.cfg.maxRpm));
  }

  setTargetSpeed(kmh) {
    this.targetSpeed = Math.max(0, Math.min(kmh, this.cfg.maxSpeed));
  }

  /**
   * Advance the model by dt seconds.
   * The input is a target speed; we smooth it so external jumps (slider
   * grabs, GPS steps) become plausible acceleration curves, from which
   * engine load is estimated.
   */
  update(dt) {
    if (dt <= 0) return;
    const cfg = this.cfg;

    // --- speed smoothing: the "vehicle" follows the input with inertia ---
    const prevSpeed = this.speed;
    // Acceleration capability shrinks near top speed, braking is stronger.
    const diff = this.targetSpeed - this.speed;
    const maxAccel = 22 * (1 - 0.7 * (this.speed / cfg.maxSpeed)); // km/h/s
    const maxBrake = 45;
    // Proportional chase toward the input; the time constant is configurable
    // (Settings → Speed smoothing) so the lag behind GPS can be dialed in.
    let rate = diff / Math.max(0.02, cfg.speedSmoothing);
    rate = Math.max(-maxBrake, Math.min(rate, maxAccel));
    this.speed = Math.max(0, this.speed + rate * dt);

    // Smoothed acceleration estimate (km/h per second). Falling accel
    // tracks faster than rising: lifting off the gas must cut the
    // engine load (and its sound) almost immediately.
    const instAccel = (this.speed - prevSpeed) / dt;
    const accelTau = instAccel < this.accel ? 0.1 : 0.25;
    this.accel += (instAccel - this.accel) * Math.min(1, dt / accelTau);

    // --- driver style estimate ---
    // Hard acceleration (and hard braking) read as sporty driving. The
    // estimate rises quickly when pushed and cools down slowly, so after
    // a burst of hard acceleration the box keeps revving out for a while
    // before settling back into relaxed early upshifts.
    const accelDemand = Math.min(1, Math.max(0, this.accel / 16));
    const brakeDemand = Math.min(1, Math.max(0, -this.accel / 18));
    const styleSignal = Math.min(1, accelDemand + brakeDemand * 0.6);
    const styleTau = styleSignal > this.aggressiveness ? 0.5 : 7.0;
    this.aggressiveness +=
      (styleSignal - this.aggressiveness) * Math.min(1, dt / styleTau);

    // Hard braking: driver is on the brake pedal, not shifting.
    this.braking = this.accel < -5;

    // --- throttle / load estimate ---
    // Neutral: the accelerator position IS the load (free revving).
    // In gear: cruise needs a little throttle (~ speed dependent),
    // accelerating a lot, decelerating means closed throttle.
    let load;
    if (this.neutral) {
      load = this.revDemand;
    } else if (this.speed < 0.5 && Math.abs(this.accel) < 0.5) {
      load = 0; // idle
    } else {
      const cruise = 0.12 + 0.18 * (this.speed / cfg.maxSpeed);
      load = cruise + this.accel / 14;
    }
    load = Math.max(0, Math.min(1, load));
    // Asymmetric: throttle closes near-instantly, opens progressively
    const thrTau = load < this.throttle ? 0.045 : this.neutral ? 0.08 : 0.12;
    this.throttle += (load - this.throttle) * Math.min(1, dt / thrTau);

    // --- gear selection (mimics driver / automatic gearbox behavior) ---
    this.kickdownInhibit = Math.max(0, this.kickdownInhibit - dt);
    if (this.neutral) {
      // drivetrain disconnected: no shifting
    } else if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
    } else {
      const g = this.gear - 1;
      const rpmNow = this.rpmInGear(this.speed, g);
      const accelerating = this.accel > 1.5;

      // Shift-up point slides with driving style: relaxed driving upshifts
      // early at an "economy" rpm, hard acceleration revs out toward the
      // configured (sporty) shift point. Instantaneous demand counts too,
      // so flooring it raises the shift point immediately instead of
      // waiting for the style estimate to catch up.
      const styleNow = Math.max(this.aggressiveness, accelDemand);
      const econUp = Math.min(
        cfg.idleRpm + 0.28 * (cfg.maxRpm - cfg.idleRpm),
        cfg.shiftUpRpm,
      );
      const effShiftUp = econUp + (cfg.shiftUpRpm - econUp) * styleNow;

      // 1st gear is for launching from a stop, not for rolling downshifts.
      // Coming down through 2nd, a driver holds 2nd and either crawls to a
      // stop or gets back on the throttle — dropping to 1st only when nearly
      // stopped or the engine is lugging near idle. (Kickdown below is the
      // exception: hard demand can still grab 1st to accelerate.)
      const enteringFirst = this.gear === 2;
      const canEnterFirst = this.speed < 6 || rpmNow <= cfg.idleRpm * 1.05;

      if (this.braking) {
        // Mid-braking a driver holds the gear (clutch/converter takes it).
        // Only as the car comes down to a stop do the gears drop through
        // quickly — but still hold 2nd until nearly stopped.
        if (
          this.gear > 1 &&
          this.speed < 10 &&
          (!enteringFirst || canEnterFirst)
        ) {
          this._shift(-1, 0.12);
        }
      } else if (
        this.gear < cfg.gears &&
        rpmNow >= effShiftUp &&
        (accelerating ||
          // Relaxation upshift: after a hard pull settles into steady
          // cruise, the decaying style estimate lowers effShiftUp until
          // it crosses below the current rpm — then shift up to bring the
          // revs down, like a driver easing off. Not while decelerating,
          // and never into a gear that would lug below the downshift point.
          (this.accel > -1.5 &&
            this.rpmInGear(this.speed, g + 1) >= cfg.shiftDownRpm * 1.15))
      ) {
        this._shift(+1);
      } else if (this.gear < cfg.gears && rpmNow >= cfg.maxRpm - 40) {
        this._shift(+1); // bounced off the limiter while cruising up
      } else if (
        // Kickdown: strong demand while below the power band — drop a gear
        // (repeats next frames if more than one gear is needed). Inhibited
        // right after an upshift so a box at full throttle doesn't hunt.
        this.gear > 1 &&
        accelDemand > 0.55 &&
        this.kickdownInhibit <= 0 &&
        rpmNow < cfg.shiftUpRpm * 0.72 &&
        this.rpmInGear(this.speed, g - 1) < cfg.shiftUpRpm * 0.95
      ) {
        this._shift(-1, 0.2);
      } else if (this.gear > 1 && rpmNow <= cfg.shiftDownRpm) {
        // Cruise-down: don't downshift into the limiter, and hold 2nd
        // rather than dropping to 1st while still rolling.
        const lower = this.rpmInGear(this.speed, g - 1);
        if (lower < effShiftUp && (!enteringFirst || canEnterFirst)) {
          this._shift(-1);
        }
      }
    }

    // --- rev limiter: fuel cut bouncing off max rpm (the "bru-bru") ---
    // Near redline the ECU cuts injection in bursts; the revs flutter and
    // the sound stutters (throttle momentarily closed). Latched with
    // hysteresis so it doesn't chatter in and out.
    if (!this.limiting && this.rpm >= cfg.maxRpm - 40) this.limiting = true;
    else if (this.limiting && this.rpm <= cfg.maxRpm - 520)
      this.limiting = false;
    if (this.limiting) {
      this.limiterPhase += dt;
      this.sparkCut = this.limiterPhase % 0.13 < 0.065; // ~7.7 Hz
    } else {
      this.limiterPhase = 0;
      this.sparkCut = false;
    }
    if (this.sparkCut) this.throttle = Math.min(this.throttle, 0.05);

    // --- rpm: free-rev in neutral, else chase the current gear ratio ---
    let targetRpm, tau;
    if (this.neutral) {
      // Rev-up is non-linear (throttle^1.3) and rate-limited by the
      // configurable time constants (flywheel inertia). Aim slightly past
      // redline so the engine pushes into the limiter instead of creeping.
      targetRpm =
        cfg.idleRpm +
        Math.pow(this.revDemand, 1.3) * (cfg.maxRpm * 1.03 - cfg.idleRpm);
      if (this.sparkCut) targetRpm = cfg.maxRpm - 400; // limiter cut pulls down
      tau = this.limiting
        ? 0.045
        : targetRpm > this.rpm
          ? cfg.revUpTime
          : cfg.revDownTime;
    } else {
      targetRpm = this.rpmInGear(this.speed, this.gear - 1);
      tau = this.shiftTimer > 0 ? 0.16 : 0.09;
    }
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt / tau);
    if (this.rpm > cfg.maxRpm) this.rpm = cfg.maxRpm; // hard rev ceiling

    // Idle jitter: a standing engine never sits perfectly still
    if (this.speed < 0.5 && this.rpm < cfg.idleRpm * 1.4) {
      this.rpm += (Math.random() - 0.5) * 12;
      this.rpm = Math.max(cfg.idleRpm * 0.95, this.rpm);
    }
  }

  _shift(dir, duration) {
    this.gear += dir;
    this.shiftDir = dir;
    if (dir > 0) this.kickdownInhibit = 2.5;
    // Sporty driving means faster shifts; explicit duration overrides.
    this.shiftTimer =
      duration !== undefined
        ? duration
        : this.cfg.shiftTime * (1 - 0.4 * this.aggressiveness);
  }

  /** True while the gearbox is mid-shift (torque cut → sound dips). */
  get shifting() {
    return this.shiftTimer > 0;
  }

  /** Displayed gear: N in neutral or at standstill, otherwise 1..N. */
  get displayGear() {
    if (this.neutral) return "N";
    return this.speed < 0.5 && this.targetSpeed < 0.5 ? "N" : String(this.gear);
  }
}

window.EngineSim = EngineSim;
