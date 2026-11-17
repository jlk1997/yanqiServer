/** 进程内异步互斥：串行化读改写，防 await 间隙丢更新（无 Redis 时诚实方案） */
export class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const prev = this.chain;
    this.chain = prev.then(() => gate);
    return prev
      .then(() => fn())
      .finally(() => {
        release();
      });
  }
}
