/** 작업에 걸린 시간을 함께 돌려준다. 화면에 API 호출 수와 걸린 시간을 기록하는 데 쓴다. */
export async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now();
  const value = await work();
  return { value, ms: Math.round(performance.now() - started) };
}
