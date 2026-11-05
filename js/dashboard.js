/**
 * Gauge — canvas analog dial (tachometer / speedometer) in the style of
 * a car instrument cluster: 260° sweep, tick marks, red zone, a glowing
 * value arc on the rim, needle, and the digital value in an LCD window
 * under the hub with the unit below it.
 */
const GAUGE_FONT = '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif';

class Gauge {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts { max, majorStep, redFrom, minorPerMajor,
   *   tickLabel, digitalFmt, unit, arcColor }
   */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = Object.assign({ arcColor: '#ff5a1f', unit: '' }, opts);
    this.value = 0;
    this.displayValue = 0;
    // 260° sweep, symmetric about the top: leaves a clear gap at the
    // bottom for the LCD window so it never crowds the end numerals.
    this.startAngle = (140 * Math.PI) / 180;
    this.endAngle = (400 * Math.PI) / 180;
    this._resize();
    this._observe();
  }

  setRange(max, majorStep, redFrom) {
    this.opts.max = max;
    this.opts.majorStep = majorStep;
    this.opts.redFrom = redFrom;
  }

  setUnit(unit) {
    this.opts.unit = unit;
  }

  /**
   * Size the dial to the largest square that fits its box and set the
   * canvas' CSS size explicitly, so the drawing is never stretched — even
   * when flex layout squeezes the box out of square, or on older browsers
   * (e.g. some car browsers) without CSS aspect-ratio.
   */
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const wrap = this.canvas.parentElement;
    let w = wrap.clientWidth, h = wrap.clientHeight;
    if (!Gauge.hasAspectRatio) {
      // No aspect-ratio: the box is only sized on one axis — square it here
      if (window.matchMedia('(orientation: portrait)').matches) h = w;
      else { wrap.style.width = h + 'px'; w = wrap.clientWidth; } // flex may shrink it
    }
    if (!h) h = w;
    const size = Math.max(50, Math.floor(Math.min(w, h)));
    if (size !== this.size) {
      this.canvas.style.width = size + 'px';
      this.canvas.style.height = size + 'px';
    }
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = size;
  }

  /** Follow the box's size (layout changes that aren't window resizes). */
  _observe() {
    if (!('ResizeObserver' in window)) return;
    let pending = false;
    new ResizeObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; this._resize(); });
    }).observe(this.canvas.parentElement);
  }

  _angleFor(v) {
    const frac = Math.max(0, Math.min(1, v / this.opts.max));
    return this.startAngle + frac * (this.endAngle - this.startAngle);
  }

  _roundRect(x, y, w, h, rad) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  draw() {
    const { ctx, size, opts } = this;
    const c = size / 2;
    const r = size * 0.46;
    ctx.clearRect(0, 0, size, size);

    // Needle inertia for a mechanical feel
    this.displayValue += (this.value - this.displayValue) * 0.25;
    const vAngle = this._angleFor(this.displayValue);

    // Face + bezel
    const face = ctx.createRadialGradient(c, c * 0.8, r * 0.1, c, c, r);
    face.addColorStop(0, '#171d29');
    face.addColorStop(1, '#090c11');
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = face;
    ctx.fill();
    const bezel = ctx.createLinearGradient(0, c - r, 0, c + r);
    bezel.addColorStop(0, '#3d4862');
    bezel.addColorStop(1, '#1a2030');
    ctx.lineWidth = Math.max(1.5, size * 0.008);
    ctx.strokeStyle = bezel;
    ctx.stroke();

    // Value arc on the rim (track + lit part with glow)
    const rArc = r * 0.95;
    const wArc = Math.max(2, size * 0.014);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(c, c, rArc, this.startAngle, this.endAngle);
    ctx.lineWidth = wArc;
    ctx.strokeStyle = '#161c28';
    ctx.stroke();
    if (vAngle > this.startAngle + 0.005) {
      ctx.save();
      ctx.shadowColor = opts.arcColor;
      ctx.shadowBlur = size * 0.03;
      ctx.beginPath();
      ctx.arc(c, c, rArc, this.startAngle, vAngle);
      ctx.strokeStyle = this.displayValue >= opts.redFrom ? '#ff2d3a' : opts.arcColor;
      ctx.stroke();
      ctx.restore();
    }
    ctx.lineCap = 'butt';

    // Red zone
    if (opts.redFrom < opts.max) {
      ctx.beginPath();
      ctx.arc(c, c, r * 0.85, this._angleFor(opts.redFrom), this.endAngle);
      ctx.lineWidth = size * 0.03;
      ctx.strokeStyle = 'rgba(255,45,58,0.85)';
      ctx.stroke();
    }

    // Ticks + numerals
    const minorStep = opts.majorStep / (opts.minorPerMajor || 4);
    const numSize = Math.round(size * 0.08);
    ctx.font = `600 ${numSize}px ${GAUGE_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= opts.max + 1e-6; v += minorStep) {
      const major = Math.abs(v % opts.majorStep) < minorStep / 2 ||
                    Math.abs((v % opts.majorStep) - opts.majorStep) < minorStep / 2;
      const a = this._angleFor(v);
      const red = v >= opts.redFrom;
      const rOut = r * 0.88;
      const rIn = r * (major ? 0.76 : 0.82);
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * rIn, c + Math.sin(a) * rIn);
      ctx.lineTo(c + Math.cos(a) * rOut, c + Math.sin(a) * rOut);
      ctx.lineWidth = major ? Math.max(2, size * 0.012) : Math.max(1, size * 0.005);
      ctx.strokeStyle = red ? '#ff2d3a' : (major ? '#dfe5ef' : '#7d8699');
      ctx.stroke();

      if (major) {
        const rt = r * 0.64;
        ctx.fillStyle = red ? '#ff6a73' : '#aab3c5';
        ctx.fillText(String(opts.tickLabel ? opts.tickLabel(v) : Math.round(v)),
          c + Math.cos(a) * rt, c + Math.sin(a) * rt);
      }
    }

    // Needle (with a short counterweight tail)
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(vAngle);
    ctx.shadowColor = 'rgba(255,90,31,0.8)';
    ctx.shadowBlur = size * 0.035;
    ctx.beginPath();
    ctx.moveTo(-r * 0.14, 0);
    ctx.lineTo(r * 0.84, 0);
    ctx.lineWidth = Math.max(2.5, size * 0.014);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ff5a1f';
    ctx.stroke();
    ctx.restore();

    // Hub
    ctx.beginPath();
    ctx.arc(c, c, r * 0.085, 0, Math.PI * 2);
    ctx.fillStyle = '#1d2434';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#3d4862';
    ctx.stroke();

    // LCD window with the digital value
    const ww = r * 0.6, wh = r * 0.27, wy = c + r * 0.31;
    this._roundRect(c - ww / 2, wy, ww, wh, r * 0.06);
    ctx.fillStyle = '#06080c';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2a3245';
    ctx.stroke();
    ctx.fillStyle = '#e8edf5';
    ctx.font = `700 ${Math.round(size * 0.115)}px ${GAUGE_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = opts.digitalFmt ? opts.digitalFmt(this.displayValue)
                                 : String(Math.round(this.displayValue));
    ctx.fillText(text, c, wy + wh * 0.54);

    // Unit
    if (opts.unit) {
      ctx.fillStyle = '#8a93a6';
      ctx.font = `600 ${Math.round(size * 0.048)}px ${GAUGE_FONT}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${(size * 0.008).toFixed(1)}px`;
      ctx.fillText(opts.unit, c, wy + wh + r * 0.13);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    }
  }
}

Gauge.hasAspectRatio = !!(window.CSS && CSS.supports && CSS.supports('aspect-ratio', '1 / 1'));

window.Gauge = Gauge;
