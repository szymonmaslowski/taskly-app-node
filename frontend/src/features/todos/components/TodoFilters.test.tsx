import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TodoFilters } from './TodoFilters'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('displays controlled values and forwards all filter changes', async () => {
  const user = userEvent.setup()
  const callbacks = {
    onFilterChange: vi.fn(),
    onSearchChange: vi.fn(),
    onSortChange: vi.fn(),
    onDueChange: vi.fn(),
  }
  const { rerender } = render(
    <TodoFilters
      filter="all"
      search=""
      sort="newest"
      due="any"
      {...callbacks}
    />,
  )
  await user.type(screen.getByLabelText('Search tasks'), 'a')
  await user.selectOptions(screen.getByLabelText('Status'), 'completed')
  await user.selectOptions(screen.getByLabelText('Sort by'), 'due')
  expect(callbacks.onSearchChange).toHaveBeenCalledWith('a')
  expect(callbacks.onFilterChange).toHaveBeenCalledWith('completed')
  expect(callbacks.onSortChange).toHaveBeenCalledWith('due')
  rerender(
    <TodoFilters
      filter="completed"
      search="demo"
      sort="due"
      due="week"
      {...callbacks}
    />,
  )
  expect(screen.getByLabelText('Search tasks')).toHaveValue('demo')
  expect(screen.getByLabelText('Status')).toHaveValue('completed')
  expect(screen.getByLabelText('Sort by')).toHaveValue('due')
})

it('forwards the selected due option and shows the controlled due value', async () => {
  const user = userEvent.setup()
  const callbacks = {
    onFilterChange: vi.fn(),
    onSearchChange: vi.fn(),
    onSortChange: vi.fn(),
    onDueChange: vi.fn(),
  }
  const { rerender } = render(
    <TodoFilters
      filter="all"
      search=""
      sort="newest"
      due="any"
      {...callbacks}
    />,
  )
  const select = screen.getByLabelText('Due')
  expect(
    within(select)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Any time', 'Overdue', 'Due today', 'Due this week'])

  await user.selectOptions(select, 'today')
  expect(callbacks.onDueChange).toHaveBeenCalledTimes(1)
  expect(callbacks.onDueChange).toHaveBeenLastCalledWith('today')

  await user.selectOptions(select, 'overdue')
  expect(callbacks.onDueChange).toHaveBeenCalledTimes(2)
  expect(callbacks.onDueChange).toHaveBeenLastCalledWith('overdue')
  expect(callbacks.onFilterChange).not.toHaveBeenCalled()
  expect(callbacks.onSortChange).not.toHaveBeenCalled()
  expect(callbacks.onSearchChange).not.toHaveBeenCalled()

  rerender(
    <TodoFilters
      filter="all"
      search=""
      sort="newest"
      due="week"
      {...callbacks}
    />,
  )
  expect(screen.getByLabelText('Due')).toHaveValue('week')
})
