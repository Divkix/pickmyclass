/** Stand-in for `cloudflare:workflows`: the real class makes a step fail without retrying. */
export class NonRetryableError extends Error {
  constructor(message: string, name = "NonRetryableError") {
    super(message);
    this.name = name;
  }
}
