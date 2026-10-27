// When the field draws its next frame. It draws at most once per `interval` ms, and never while the
// GPU is still busy with the last frame. A frame still drawing when the next one is due also holds
// the next one back until twice its own time has passed, so on a device that cannot keep up,
// drawing takes at most half of what the device can give.
export class Pace {
  constructor(interval) {
    this.interval = interval;
    this.restart();
  }

  // Called on every animation tick. `drawing` is whether the GPU is still busy with the last frame;
  // `counts` is false when that frame's time says nothing about the next, as when it was the first
  // to use a program and paid for compiling it. Returns the ms since the last frame if the next one
  // is due, otherwise null.
  due(now, drawing, counts) {
    const elapsed = this.last ? now - this.last : this.interval;
    if (!this.reached(elapsed)) return null;
    if (drawing) {
      this.late = true;
      return null;
    }
    if (this.late && counts) this.wait = Math.max(this.interval, 2 * elapsed);
    this.late = false;
    return this.reached(elapsed) ? elapsed : null;
  }

  // Records a frame submitted at `now`.
  drew(now) {
    this.last = now;
    this.wait = this.interval;
  }

  // Forgets the last frame, as when the page comes back after being hidden: time spent away is not
  // time spent drawing.
  restart() {
    this.last = 0; // when the last frame was submitted; 0 for none
    this.wait = this.interval; // ms from the last frame to the next
    this.late = false; // whether the last frame was still drawing when the next one was due
  }

  // The millisecond absorbs jitter in animation timestamps, which would otherwise skip a tick.
  reached(elapsed) {
    return elapsed >= this.wait - 1;
  }
}
