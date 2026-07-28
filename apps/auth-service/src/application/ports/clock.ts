export const CLOCK = Symbol('CLOCK');

/** Injected instead of calling Date directly so expiry logic is testable. */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
