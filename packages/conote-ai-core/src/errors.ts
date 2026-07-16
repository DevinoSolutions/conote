/**
 * Error thrown when an AI provider returns a non-success response.
 * `status` is the HTTP status code when the failure originated from an HTTP response.
 */
export class AiProviderError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AiProviderError'
    this.status = status
    // Restore prototype chain for extends Error under transpilation to older targets.
    Object.setPrototypeOf(this, AiProviderError.prototype)
  }
}
