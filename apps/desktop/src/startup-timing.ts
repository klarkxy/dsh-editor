/** One-line desktop boot timings. Durations and hit/deploy only; never URLs. */
export class StartupTiming {
  private readonly parts: string[] = []

  async measure<T>(label: string, work: () => Promise<T>, detail?: (result: T) => string | undefined): Promise<T> {
    const started = Date.now()
    const result = await work()
    const extra = detail?.(result)
    this.parts.push(`${label}${extra ? ` ${extra}` : ''} ${Date.now() - started}ms`)
    return result
  }

  flush(write: (line: string) => void = (line) => { console.log(line) }): void {
    if (this.parts.length === 0) return
    write(`desktop startup: ${this.parts.join(', ')}`)
  }
}
