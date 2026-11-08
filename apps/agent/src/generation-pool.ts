/** The bounded generation lane is shared by readonly planning and all Workers. */
export class GenerationPool {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(work: () => Promise<T>): Promise<T> {
    const before = this.tail; let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await before;
    try { return await work(); } finally { release(); }
  }
}
