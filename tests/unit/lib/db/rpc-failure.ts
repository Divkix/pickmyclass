import { expect } from 'vite-plus/test';

export async function expectRpcFailure(
  actual: Promise<unknown>,
  operation: string,
  cause: string
): Promise<void> {
  await expect(actual).rejects.toThrow(`${operation}: ${cause}`);
}
