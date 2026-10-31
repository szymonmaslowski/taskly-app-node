import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

afterEach(() => {
  vi.useRealTimers()
})

function renderItem(
  todo: Todo = todoFixture,
  props: { busy?: boolean } = {},
) {
  const handlers = { onEdit: vi.fn(), onToggle: vi.fn(), onDelete: vi.fn() }
  const view = render(
    <TodoItem todo={todo} busy={props.busy ?? false} {...handlers} />,
  )
  return { ...handlers, ...view }
}

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={onEdit}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  expect(screen.getByText('To do')).toBeVisible()
  expect(screen.getByText('Medium')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

it('shows a completed task and forwards toggle requests', async () => {
  const user = userEvent.setup()
  const { onToggle } = renderItem({ ...todoFixture, completed: true })
  expect(screen.getByText('Completed')).toBeVisible()
  expect(screen.queryByText('To do')).not.toBeInTheDocument()
  const checkbox = screen.getByRole('checkbox', {
    name: `Mark as active: ${todoFixture.title}`,
  })
  expect(checkbox).toBeChecked()
  await user.click(checkbox)
  expect(onToggle).toHaveBeenCalledTimes(1)
})

it('names the checkbox as completing an active task', () => {
  renderItem()
  expect(
    screen.getByRole('checkbox', { name: `Complete: ${todoFixture.title}` }),
  ).not.toBeChecked()
})

it('shows the description when there is one', () => {
  renderItem({ ...todoFixture, description: 'Line one' })
  expect(screen.getByText('Line one')).toBeVisible()
})

it('renders no description block when the description is empty', () => {
  const { container } = renderItem()
  expect(container.querySelectorAll('p')).toHaveLength(0)
})

it('forwards delete requests', async () => {
  const user = userEvent.setup()
  const { onDelete, onEdit, onToggle } = renderItem()
  await user.click(
    screen.getByRole('button', { name: `Delete: ${todoFixture.title}` }),
  )
  expect(onDelete).toHaveBeenCalledTimes(1)
  expect(onEdit).not.toHaveBeenCalled()
  expect(onToggle).not.toHaveBeenCalled()
})

it.each([
  { due: '2026-10-29', text: '29 Oct 2026 · overdue' },
  { due: '2026-10-30', text: '30 Oct 2026' },
  { due: '2026-11-01', text: '1 Nov 2026' },
])('shows the due date $due as "$text"', ({ due, text }) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 30, 12, 0, 0))
  renderItem({ ...todoFixture, due_date: due })
  expect(screen.getByText(text)).toBeVisible()
})

it('does not mark a completed task with a past due date as overdue', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 30, 12, 0, 0))
  renderItem({ ...todoFixture, completed: true, due_date: '2026-10-01' })
  expect(screen.getByText('1 Oct 2026')).toBeVisible()
  expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
})

it('disables toggle, edit and delete while busy', async () => {
  const user = userEvent.setup()
  const { onEdit, onToggle, onDelete } = renderItem(todoFixture, {
    busy: true,
  })
  const checkbox = screen.getByRole('checkbox')
  const edit = screen.getByRole('button', { name: `Edit: ${todoFixture.title}` })
  const remove = screen.getByRole('button', {
    name: `Delete: ${todoFixture.title}`,
  })
  expect(checkbox).toBeDisabled()
  expect(edit).toBeDisabled()
  expect(remove).toBeDisabled()
  await user.click(checkbox)
  await user.click(edit)
  await user.click(remove)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onEdit).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})
