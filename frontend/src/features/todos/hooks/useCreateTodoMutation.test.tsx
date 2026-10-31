import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo, TodoInput } from '../types'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function createWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

const input: TodoInput = {
  title: 'New task',
  description: '',
  priority: 'low',
  due_date: null,
  completed: false,
}

const todoA: Todo = { ...todoFixture, id: 1, title: 'Task A' }
const saved: Todo = { ...todoFixture, id: 2, title: 'Saved task' }

function setup() {
  const client = createClient()
  const { result } = renderHook(() => useCreateTodoMutation(), {
    wrapper: createWrapper(client),
  })
  return { client, result }
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('useCreateTodoMutation', () => {
  it('calls the create API with the input and prepends the saved todo to the cached list', async () => {
    vi.mocked(todosApi.create).mockResolvedValue(saved)
    const { client, result } = setup()
    client.setQueryData(todoKeys.list, [todoA])

    await act(async () => {
      await result.current.mutateAsync(input)
    })

    expect(todosApi.create).toHaveBeenCalledTimes(1)
    expect(todosApi.create).toHaveBeenCalledWith(input)
    expect(client.getQueryData(todoKeys.list)).toEqual([saved, todoA])
  })

  it('creates the list in the cache when no list is cached yet', async () => {
    vi.mocked(todosApi.create).mockResolvedValue(saved)
    const { client, result } = setup()

    await act(async () => {
      await result.current.mutateAsync(input)
    })

    expect(client.getQueryData(todoKeys.list)).toEqual([saved])
  })

  it('replaces a cached todo with the same id instead of duplicating it', async () => {
    vi.mocked(todosApi.create).mockResolvedValue(saved)
    const { client, result } = setup()
    client.setQueryData(todoKeys.list, [
      { ...saved, title: 'Old title' },
      todoA,
    ])

    await act(async () => {
      await result.current.mutateAsync(input)
    })

    expect(client.getQueryData(todoKeys.list)).toEqual([saved, todoA])
  })

  it('cancels in-flight list queries before writing the saved todo', async () => {
    vi.mocked(todosApi.create).mockResolvedValue(saved)
    const { client, result } = setup()
    let resolveStale: (todos: Todo[]) => void = () => {}
    const stale = new Promise<Todo[]>((resolve) => {
      resolveStale = resolve
    })
    const inFlight = client
      .fetchQuery({ queryKey: todoKeys.list, queryFn: () => stale })
      .catch(() => undefined)

    await act(async () => {
      await result.current.mutateAsync(input)
    })
    await act(async () => {
      resolveStale([todoA])
      await inFlight
    })

    expect(client.getQueryData(todoKeys.list)).toEqual([saved])
  })

  it('leaves the cache unchanged when the create API rejects', async () => {
    const error = new Error('Could not create.')
    vi.mocked(todosApi.create).mockRejectedValue(error)
    const { client, result } = setup()
    client.setQueryData(todoKeys.list, [todoA])

    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toThrow(error)
    })

    expect(client.getQueryData(todoKeys.list)).toEqual([todoA])
  })
})
