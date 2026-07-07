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
    this.cfg = Object.assign({
      maxRpm: 7000,        // rev limiter
      idleRpm: 850,
      maxSpeed: 250,       // km/h at maxRpm in top gear
      gears: 6,
      shiftUpRpm: 6200,    // upshift threshold under acceleration
      shiftDownRpm: 1800,  // downshift threshold
      shiftTime: 0.30,     // seconds of torque cut while shifting
      firstGearFrac: 0.16, // fraction of maxSpeed reachable in 1st gear
    }, config);
    this._computeGearing();
  }

  /**
   * Geometric gear spacing (close ratios up top, short 1st gear),
   * expressed as the road speed each gear reaches at maxRpm.
   */
  _computeGearing() {
    const { gears, maxSpeed, firstGearFrac } = this.cfg;
    this.gearTopSpeed = [];
    if (gears === 1) {
      this.gearTopSpeed.push(maxSpeed);
      return;
    }
    const step = Math.pow(firstGearFrac, 1 / (gears - 1));
    for (let i = 0; i < gears; i++) {
      this.gearTopSpeed.push(maxSpeed * Math.pow(step, gears - 1 - i));
    }
  }

  reset() {
    this.speed = 0;          // km/h (smoothed actual)
    this.targetSpeed = 0;    // km/h (raw input)
    this.gear = 1;           // 1-based
    this.rpm = this.cfg.idleRpm;
    this.throttle = 0;       // 0..1 estimated engine load
    this.accel = 0;          // km/h per second (smoothed)
    this.shiftTimer = 0;     // >0 while a shift is in progress
    this.shiftDir = 0;       // +1 up, -1 down
    this.aggressiveness = 0; // 0 relaxed .. 1 sporty (driver style estimate)
    this.braking = false;    // true under hard deceleration
    this.kickdownInhibit = 0; // no kickdown right after an upshift (no hunting)
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
    let rate = diff * 1.2; // proportional chase
    rate = Math.max(-maxBrake, Math.min(rate, maxAccel));
    this.speed = Math.max(0, this.speed + rate * dt);

    // Smoothed acceleration estimate (km/h per second)
    const instAccel = (this.speed - prevSpeed) / dt;
    this.accel += (instAccel - this.accel) * Math.min(1, dt / 0.25);

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
    // Cruise needs a little throttle (~ speed dependent), accelerating
    // needs a lot, decelerating means closed throttle (engine braking).
    let load;
    if (this.speed < 0.5 && Math.abs(this.accel) < 0.5) {
      load = 0; // idle
    } else {
      const cruise = 0.12 + 0.18 * (this.speed / cfg.maxSpeed);
      load = cruise + this.accel / 14;
    }
    load = Math.max(0, Math.min(1, load));
    this.throttle += (load - this.throttle) * Math.min(1, dt / 0.12);

    // --- gear selection (mimics driver / automatic gearbox behavior) ---
    this.kickdownInhibit = Math.max(0, this.kickdownInhibit - dt);
    if (this.shiftTimer > 0) {
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
        cfg.idleRpm + 0.28 * (cfg.maxRpm - cfg.idleRpm), cfg.shiftUpRpm);
      const effShiftUp = econUp + (cfg.shiftUpRpm - econUp) * styleNow;

      if (this.braking) {
        // Mid-braking a driver holds the gear (clutch/converter takes it).
        // Only as the car comes down to a stop do the gears drop through
        // quickly so we're back in 1st when it halts.
        if (this.gear > 1 && this.speed < 10) {
          this._shift(-1, 0.12);
        }
      } else if (this.gear < cfg.gears && rpmNow >= effShiftUp &&
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
        this.gear > 1 && accelDemand > 0.55 && this.kickdownInhibit <= 0 &&
        rpmNow < cfg.shiftUpRpm * 0.72 &&
        this.rpmInGear(this.speed, g - 1) < cfg.shiftUpRpm * 0.95
      ) {
        this._shift(-1, 0.2);
      } else if (this.gear > 1 && rpmNow <= cfg.shiftDownRpm) {
        // Cruise-down: don't downshift into the limiter
        const lower = this.rpmInGear(this.speed, g - 1);
        if (lower < effShiftUp) this._shift(-1);
      }
    }

    // --- rpm: chase the geometric value for the current gear ---
    let targetRpm = this.rpmInGear(this.speed, this.gear - 1);
    let tau = 0.09; // engine responds fast
    if (this.shiftTimer > 0) {
      tau = 0.16;   // rev fall/rise across a shift is a bit slower
    }
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt / tau);

    // Idle jitter: a standing engine never sits perfectly still
    if (this.speed < 0.5) {
      this.rpm += (Math.random() - 0.5) * 12;
      this.rpm = Math.max(cfg.idleRpm * 0.95, this.rpm);
    }
  }

  _shift(dir, duration) {
    this.gear += dir;
    this.shiftDir = dir;
    if (dir > 0) this.kickdownInhibit = 2.5;
    // Sporty driving means faster shifts; explicit duration overrides.
    this.shiftTimer = duration !== undefined
      ? duration
      : this.cfg.shiftTime * (1 - 0.4 * this.aggressiveness);
  }

  /** True while the gearbox is mid-shift (torque cut → sound dips). */
  get shifting() {
    return this.shiftTimer > 0;
  }

  /** Displayed gear: N at standstill, otherwise 1..N. */
  get displayGear() {
    return this.speed < 0.5 && this.targetSpeed < 0.5 ? 'N' : String(this.gear);
  }
}

window.EngineSim = EngineSim;
