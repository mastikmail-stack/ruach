// Critically damped motion: retargeting keeps the current position AND velocity.
// The analytic update behaves the same at different frame rates.
export class DampedValue {
  constructor(value, tolerance = .01, response = 10) {
    this.tolerance = tolerance;
    this.response = response;
    this.snap(value);
  }
  snap(value) { this.value = this.target = value; this.velocity = 0; }
  to(target) { this.target = target; }
  angleTo(target) { this.to(this.value + shortestTurn(this.value, target)); }
  get settled() { return this.value === this.target && this.velocity === 0; }
  step(seconds) {
    const dt = Math.max(0, seconds), w = this.response;
    const offset = this.value - this.target, c = this.velocity + w * offset;
    const decay = Math.exp(-w * dt);
    this.value = this.target + (offset + c * dt) * decay;
    this.velocity = (this.velocity - w * c * dt) * decay;
    if (Math.abs(this.value - this.target) < this.tolerance && Math.abs(this.velocity) < this.tolerance * w) this.snap(this.target);
    return this.value;
  }
}

export const shortestTurn = (from, to) => ((to - from) % 360 + 540) % 360 - 180;
