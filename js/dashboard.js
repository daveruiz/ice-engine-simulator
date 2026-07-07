/**
 * Gauge — canvas analog dial (tachometer / speedometer) in the style of
 * a car instrument cluster: 240° sweep, tick marks, red zone, glowing
 * needle, digital value in the hub.
 */
class Gauge {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts { max, majorStep, redFrom, label, digitalFmt }
   */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.value = 0;
    this.displayValue = 0;
    this.startAngle = (3 * Math.PI) / 4;                 // 135°
    this.endAngle = this.startAngle + (3 * Math.PI) / 2; // 270° sweep (135°→405°)
    this._resize();
  }

  setRange(max, majorStep, redFrom) {
    this.opts.max = max;
    this.opts.majorStep = majorStep;
    this.opts.redFrom = redFrom;
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(50, Math.min(rect.width, rect.height));
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = size;
  }

  _angleFor(v) {
    const frac = Math.max(0, Math.min(1, v / this.opts.max));
    return this.startAngle + frac * (this.endAngle - this.startAngle);
  }

  draw() {
    const { ctx, size, opts } = this;
    const c = size / 2;
    const r = size * 0.46;
    ctx.clearRect(0, 0, size, size);

    // Needle inertia for a mechanical feel
    this.displayValue += (this.value - this.displayValue) * 0.25;

    // Face
    const face = ctx.createRadialGradient(c, c, r * 0.1, c, c, r);
    face.addColorStop(0, '#161b26');
    face.addColorStop(1, '#0a0d13');
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = face;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2a3245';
    ctx.stroke();

    // Red zone arc
    if (opts.redFrom < opts.max) {
      ctx.beginPath();
      ctx.arc(c, c, r * 0.86, this._angleFor(opts.redFrom), this.endAngle);
      ctx.lineWidth = size * 0.035;
      ctx.strokeStyle = 'rgba(255,45,58,0.85)';
      ctx.stroke();
    }

    // Ticks + numerals
    const minorStep = opts.majorStep / (opts.minorPerMajor || 4);
    for (let v = 0; v <= opts.max + 1e-6; v += minorStep) {
      const major = Math.abs(v % opts.majorStep) < minorStep / 2 ||
                    Math.abs((v % opts.majorStep) - opts.majorStep) < minorStep / 2;
      const a = this._angleFor(v);
      const rOut = r * 0.88;
      const rIn = r * (major ? 0.76 : 0.82);
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * rIn, c + Math.sin(a) * rIn);
      ctx.lineTo(c + Math.cos(a) * rOut, c + Math.sin(a) * rOut);
      ctx.lineWidth = major ? 3 : 1.5;
      ctx.strokeStyle = v >= opts.redFrom ? '#ff2d3a' : '#c7d0e0';
      ctx.stroke();

      if (major) {
        const rt = r * 0.63;
        ctx.fillStyle = v >= opts.redFrom ? '#ff6a73' : '#8a93a6';
        ctx.font = `600 ${Math.round(size * 0.075)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(opts.tickLabel ? opts.tickLabel(v) : Math.round(v)),
          c + Math.cos(a) * rt, c + Math.sin(a) * rt);
      }
    }

    // Needle
    const a = this._angleFor(this.displayValue);
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(a);
    ctx.shadowColor = 'rgba(255,90,31,0.8)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(-r * 0.12, 0);
    ctx.lineTo(r * 0.84, 0);
    ctx.lineWidth = Math.max(2.5, size * 0.014);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ff5a1f';
    ctx.stroke();
    ctx.restore();

    // Hub
    ctx.beginPath();
    ctx.arc(c, c, r * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = '#1d2434';
    ctx.fill();
    ctx.strokeStyle = '#3a4356';
    ctx.stroke();

    // Digital value under the hub
    ctx.fillStyle = '#e8edf5';
    ctx.font = `700 ${Math.round(size * 0.11)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = opts.digitalFmt ? opts.digitalFmt(this.displayValue)
                                 : String(Math.round(this.displayValue));
    ctx.fillText(text, c, c + r * 0.38);
  }
}

window.Gauge = Gauge;
