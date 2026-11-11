const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createSendQueue(delayMs: number) {
    let tail: Promise<unknown> = Promise.resolve();

    return function enqueue<T>(task: () => Promise<T>): Promise<T> {
        const run = tail.then(task);
        tail = run.catch(() => {}).then(() => sleep(delayMs));
        return run;
    };
}
