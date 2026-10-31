import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { useTodoFilters } from './useTodoFilters'

const active: Todo = {
  ...todoFixture,
  id: 1,
  title: 'Prepare a demo',
  priority: 'low',
  created_at: '2026-10-01T12:00:00Z',
}
const completed: Todo = {
  ...todoFixture,
  id: 2,
  title: 'Write report',
  priority: 'high',
  completed: true,
  created_at: '2026-10-02T12:00:00Z',
}

function setup(todos: Todo[] = [active, completed]) {
  return renderHook((props: Todo[]) => useTodoFilters(props), {
    initialProps: todos,
  })
}

describe('useTodoFilters', () => {
  it('starts with all filter, empty search, newest sort and every todo visible', () => {
    const { result } = setup()

    expect(result.current.filter).toBe('all')
    expect(result.current.search).toBe('')
    expect(result.current.sort).toBe('newest')
    expect(result.current.visible).toEqual([completed, active])
  })

  it('narrows to completed todos when the filter changes', () => {
    const { result } = setup()

    act(() => result.current.setFilter('completed'))

    expect(result.current.filter).toBe('completed')
    expect(result.current.visible).toEqual([completed])
  })

  it('narrows by a trimmed, case-insensitive search', () => {
    const { result } = setup()

    act(() => result.current.setSearch('  DEMO '))

    expect(result.current.search).toBe('  DEMO ')
    expect(result.current.visible).toEqual([active])
  })

  it('orders high priority before low when the sort changes', () => {
    const { result } = setup()

    act(() => result.current.setSort('priority'))

    expect(result.current.sort).toBe('priority')
    expect(result.current.visible).toEqual([completed, active])
  })

  it('recomputes visible when the todos argument changes', () => {
    const { result, rerender } = setup([active])
    act(() => result.current.setSearch('report'))
    expect(result.current.visible).toEqual([])

    rerender([active, completed])

    expect(result.current.search).toBe('report')
    expect(result.current.visible).toEqual([completed])
  })
})
