import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  initialize: vi.fn(),
  resolveDatabaseUrl: vi.fn(),
  createApp: vi.fn(),
}));

vi.mock('../src/core/database.ts', () => ({ createDatabase: mocks.createDatabase, initialize: mocks.initialize }));
vi.mock('../src/core/config.ts', () => ({ resolveDatabaseUrl: mocks.resolveDatabaseUrl }));
vi.mock('../src/factory.ts', () => ({ createApp: mocks.createApp }));

import { start } from '../src/core/lifespan.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  mocks.createDatabase.mockReset();
  mocks.initialize.mockReset();
  mocks.resolveDatabaseUrl.mockReset();
  mocks.createApp.mockReset();
});

function setup({ port = 8000, failListen }: { port?: number; failListen?: Error } = {}) {
  vi.stubEnv('API_PORT', '');
  const database = { $connect: vi.fn().mockResolvedValue(undefined), $disconnect: vi.fn().mockResolvedValue(undefined) };
  const closeCallbacks: Array<() => Promise<void>> = [];
  const listener = Object.assign(new EventEmitter(), {
    address: () => ({ port }),
    close: vi.fn((callback: () => Promise<void>) => {
      closeCallbacks.push(callback);
    }),
  });
  const listen = vi.fn((_port: number, _host: string, callback: () => void) => {
    queueMicrotask(() => (failListen ? listener.emit('error', failListen) : callback()));
    return listener;
  });
  mocks.resolveDatabaseUrl.mockReturnValue('postgresql://resolved');
  mocks.createDatabase.mockReturnValue(database);
  mocks.initialize.mockResolvedValue(undefined);
  mocks.createApp.mockReturnValue({ listen });
  const handlers: Record<string, () => void> = {};
  const once = vi.spyOn(process, 'once').mockImplementation(((event: string, handler: () => void) => {
    handlers[event] = handler;
    return process;
  }) as unknown as typeof process.once);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return { database, listener, listen, once, handlers, closeCallbacks };
}

it('connects, initialises, then listens, and returns the server and database', async () => {
  const { database, listener, listen } = setup();

  const result = await start();

  expect(mocks.createDatabase).toHaveBeenCalledWith('postgresql://resolved');
  const order = [
    database.$connect.mock.invocationCallOrder[0],
    mocks.initialize.mock.invocationCallOrder[0],
    mocks.createApp.mock.invocationCallOrder[0],
    listen.mock.invocationCallOrder[0],
  ];
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(mocks.initialize).toHaveBeenCalledWith(database);
  expect(mocks.createApp).toHaveBeenCalledWith(database);
  expect(result).toEqual({ server: listener, database });
  expect(result.server).toBe(listener);
  expect(result.database).toBe(database);
});

it('listens on API_PORT on 0.0.0.0', async () => {
  const { listen } = setup();
  vi.stubEnv('API_PORT', '9123');

  await start();

  expect(listen).toHaveBeenCalledWith(9123, '0.0.0.0', expect.any(Function));
});

it('listens on 8000 by default when API_PORT is empty', async () => {
  const { listen } = setup();

  await start();

  expect(listen).toHaveBeenCalledWith(8000, '0.0.0.0', expect.any(Function));
});

it('listens on 8000 by default when API_PORT is unset', async () => {
  const { listen } = setup();
  vi.stubEnv('API_PORT', undefined);

  await start();

  expect(listen).toHaveBeenCalledWith(8000, '0.0.0.0', expect.any(Function));
});

it('logs the port the server is listening on', async () => {
  setup({ port: 4321 });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});

  await start();

  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith('Taskly App Node API listening on port 4321');
});

it('disconnects and rethrows when connect fails, without initialising or listening', async () => {
  const { database, listen } = setup();
  database.$connect.mockRejectedValue(new Error('connect failed'));

  await expect(start()).rejects.toThrow('connect failed');

  expect(database.$disconnect).toHaveBeenCalledTimes(1);
  expect(mocks.initialize).not.toHaveBeenCalled();
  expect(listen).not.toHaveBeenCalled();
});

it('disconnects and rethrows when the server fails to listen', async () => {
  const { database } = setup({ failListen: new Error('EADDRINUSE') });

  await expect(start()).rejects.toThrow('EADDRINUSE');

  expect(database.$disconnect).toHaveBeenCalledTimes(1);
});

it('registers shutdown handlers once for SIGTERM and SIGINT', async () => {
  const { once } = setup();

  await start();

  expect(once).toHaveBeenCalledTimes(2);
  expect(once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  expect(once).toHaveBeenCalledWith('SIGINT', expect.any(Function));
});

it('does not register shutdown handlers when start fails', async () => {
  const { database, once } = setup();
  database.$connect.mockRejectedValue(new Error('connect failed'));

  await expect(start()).rejects.toThrow('connect failed');

  expect(once).not.toHaveBeenCalled();
});

it('shutdown closes the server, then disconnects the database and cancels the forced exit', async () => {
  const { database, listener, handlers, closeCallbacks } = setup();
  await start();
  vi.useFakeTimers();
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

  handlers.SIGTERM();

  expect(listener.close).toHaveBeenCalledTimes(1);
  expect(database.$disconnect).not.toHaveBeenCalled();
  await closeCallbacks[0]();
  expect(database.$disconnect).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(10000);
  expect(exit).not.toHaveBeenCalled();
});

it('shutdown forces exit with code 1 after 10 seconds if the server does not close', async () => {
  const { handlers } = setup();
  await start();
  vi.useFakeTimers();
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

  handlers.SIGINT();

  vi.advanceTimersByTime(9999);
  expect(exit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(exit).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledWith(1);
});

it('shutdown reports a disconnect failure and sets a failing exit code', async () => {
  const { database, handlers, closeCallbacks } = setup();
  await start();
  vi.useFakeTimers();
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const failure = new Error('disconnect failed');
  database.$disconnect.mockRejectedValue(failure);
  const originalExitCode = process.exitCode;

  handlers.SIGTERM();
  await closeCallbacks[0]();
  const exitCode = process.exitCode;
  process.exitCode = originalExitCode;
  vi.advanceTimersByTime(10000);

  expect(consoleError).toHaveBeenCalledWith(failure);
  expect(exitCode).toBe(1);
  expect(exit).not.toHaveBeenCalled();
});
