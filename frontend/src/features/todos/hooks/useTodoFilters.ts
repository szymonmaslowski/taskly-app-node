import { useState } from 'react'
import type { DueFilter, Filter, Sort, Todo } from '../types'
import { selectTodos } from '../utils/todos'

export function useTodoFilters(todos: Todo[]) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const [due, setDue] = useState<DueFilter>('any')
  return {
    filter,
    setFilter,
    search,
    setSearch,
    sort,
    setSort,
    due,
    setDue,
    visible: selectTodos(todos, filter, search, sort, due),
  }
}
