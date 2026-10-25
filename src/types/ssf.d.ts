declare module "ssf" {
  /** Formats a value with an Excel number format code. */
  export function format(fmt: string | number, value: unknown, opts?: Record<string, unknown>): string;
}
