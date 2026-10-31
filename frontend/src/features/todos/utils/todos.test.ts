import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDate, isOverdue, selectTodos, validateTodo } from './todos'
import type { Todo, TodoInput } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })

  it('filters completed tasks and keeps all with the all filter', () => {
    const active = { ...base, id: 1 }
    const completed = { ...base, id: 2, completed: true }
    const todos = [active, completed]

    expect(selectTodos(todos, 'completed', '', 'newest')).toEqual([completed])
    expect(selectTodos(todos, 'all', '', 'newest')).toEqual([completed, active])
  })

  it('searches the title ignoring case and treats a blank query as match-all', () => {
    const other = { ...base, id: 2, title: 'Groceries' }
    const todos = [base, other]

    expect(selectTodos(todos, 'all', 'SPRINT', 'newest')).toEqual([base])
    expect(selectTodos(todos, 'all', '   ', 'newest')).toEqual([other, base])
  })

  it('sorts newest first by created_at, breaking ties by higher id', () => {
    const oldest = { ...base, id: 1, created_at: '2026-10-01T12:00:00Z' }
    const newest = { ...base, id: 2, created_at: '2026-10-03T12:00:00Z' }
    const tieLow = { ...base, id: 5, created_at: '2026-10-02T12:00:00Z' }
    const tieHigh = { ...base, id: 6, created_at: '2026-10-02T12:00:00Z' }

    expect(
      selectTodos([oldest, tieLow, newest, tieHigh], 'all', '', 'newest'),
    ).toEqual([newest, tieHigh, tieLow, oldest])
  })

  it('sorts by priority high, medium, low with higher id first on ties', () => {
    const low = { ...base, id: 1, priority: 'low' as const }
    const medium = { ...base, id: 2, priority: 'medium' as const }
    const high = { ...base, id: 3, priority: 'high' as const }
    const laterHigh = { ...base, id: 4, priority: 'high' as const }

    expect(
      selectTodos([low, medium, high, laterHigh], 'all', '', 'priority'),
    ).toEqual([laterHigh, high, medium, low])
  })

  it('sorts by due date ascending with undated tasks last and ties by higher id', () => {
    const november = { ...base, id: 1, due_date: '2026-11-02' }
    const undated = { ...base, id: 2, due_date: null }
    const octoberLow = { ...base, id: 3, due_date: '2026-10-05' }
    const octoberHigh = { ...base, id: 4, due_date: '2026-10-05' }

    expect(
      selectTodos(
        [november, undated, octoberLow, octoberHigh],
        'all',
        '',
        'due',
      ),
    ).toEqual([octoberHigh, octoberLow, november, undated])
  })
})

describe('validateTodo', () => {
  const valid: TodoInput = {
    title: 'Plan',
    description: '',
    priority: 'medium',
    due_date: '',
    completed: false,
  }

  it('returns no errors for a valid task with an empty due date', () => {
    expect(validateTodo(valid)).toEqual({})
  })

  it('rejects an empty or whitespace-only title', () => {
    expect(validateTodo({ ...valid, title: '   ' })).toEqual({
      title: 'Enter a task title.',
    })
  })

  it('accepts a title of 120 characters and rejects 121', () => {
    expect(validateTodo({ ...valid, title: 'a'.repeat(120) })).toEqual({})
    expect(validateTodo({ ...valid, title: `  ${'a'.repeat(120)}  ` })).toEqual(
      {},
    )
    expect(validateTodo({ ...valid, title: 'a'.repeat(121) })).toEqual({
      title: 'The title must be at most 120 characters.',
    })
  })

  it('accepts a description of 2000 characters and rejects 2001 after trimming', () => {
    expect(validateTodo({ ...valid, description: 'a'.repeat(2000) })).toEqual(
      {},
    )
    expect(
      validateTodo({ ...valid, description: ` ${'a'.repeat(2000)} ` }),
    ).toEqual({})
    expect(validateTodo({ ...valid, description: 'a'.repeat(2001) })).toEqual({
      description: 'The description must be at most 2000 characters.',
    })
  })

  it.each(['2028-02-29', '2026-10-30'])(
    'accepts a real calendar due date %s',
    (due_date) => {
      expect(validateTodo({ ...valid, due_date })).toEqual({})
    },
  )

  it.each([
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2027-02-29',
    '26-10-01',
    '2026-1-1',
    'tomorrow',
  ])('rejects invalid due date %s with a message', (due_date) => {
    expect(validateTodo({ ...valid, due_date })).toEqual({
      due_date: 'Enter a valid date.',
    })
  })

  it('reports every invalid field at once', () => {
    expect(
      validateTodo({
        ...valid,
        title: ' ',
        description: 'a'.repeat(2001),
        due_date: '2026-02-30',
      }),
    ).toEqual({
      title: 'Enter a task title.',
      description: 'The description must be at most 2000 characters.',
      due_date: 'Enter a valid date.',
    })
  })
})

describe('isOverdue', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is true only for an active task due before today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 30, 12, 0, 0))

    expect(isOverdue({ ...base, due_date: '2026-10-29' })).toBe(true)
    expect(isOverdue({ ...base, due_date: '2026-10-30' })).toBe(false)
    expect(isOverdue({ ...base, due_date: '2026-10-31' })).toBe(false)
  })

  it('is false for completed and undated tasks', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 30, 12, 0, 0))

    expect(
      isOverdue({ ...base, completed: true, due_date: '2026-10-01' }),
    ).toBe(false)
    expect(isOverdue({ ...base, due_date: null })).toBe(false)
  })

  it('compares against the local calendar date with zero padding', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 5, 10, 0, 0))

    expect(isOverdue({ ...base, due_date: '2026-03-04' })).toBe(true)
    expect(isOverdue({ ...base, due_date: '2026-03-05' })).toBe(false)
  })
})

describe('formatDate', () => {
  it('formats a date as day, short month and year in en-GB', () => {
    expect(formatDate('2026-10-05')).toBe('5 Oct 2026')
  })
})
