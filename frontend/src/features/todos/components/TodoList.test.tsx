import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { TodoList } from './TodoList'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoEmptyState', () => ({
  TodoEmptyState: ({
    hasTodos,
    disabled,
    onCreate,
  }: {
    hasTodos: boolean
    disabled: boolean
    onCreate: () => void
  }) => (
    <div>
      <p>Empty task list</p>
      <p>{`hasTodos: ${hasTodos}`}</p>
      <button disabled={disabled} onClick={onCreate}>
        Create
      </button>
    </div>
  ),
}))
vi.mock('./TodoItem', () => ({
  TodoItem: ({
    todo,
    busy,
    onToggle,
    onEdit,
    onDelete,
  }: {
    todo: Todo
    busy: boolean
    onToggle: () => void
    onEdit: () => void
    onDelete: () => void
  }) => (
    <li>
      <span>{todo.title}</span>
      <button disabled={busy} onClick={onToggle}>
        {`Toggle ${todo.title}`}
      </button>
      <button disabled={busy} onClick={onEdit}>
        {`Edit ${todo.title}`}
      </button>
      <button disabled={busy} onClick={onDelete}>
        {`Delete ${todo.title}`}
      </button>
    </li>
  ),
}))

const secondTodo: Todo = { ...todoFixture, id: 8, title: 'Write the report' }

function setup(overrides: Partial<Parameters<typeof TodoList>[0]> = {}) {
  const props = {
    todos: [],
    hasTodos: false,
    loading: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<TodoList {...props} />)
  return props
}

it('shows loading feedback before showing an empty list', () => {
  const props = {
    todos: [],
    hasTodos: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
  const { rerender } = render(<TodoList {...props} loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  rerender(<TodoList {...props} loading={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
})

it('renders an item per todo and binds each action to its own todo', async () => {
  const user = userEvent.setup()
  const props = setup({ todos: [todoFixture, secondTodo], hasTodos: true })

  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  await user.click(
    screen.getByRole('button', { name: `Toggle ${secondTodo.title}` }),
  )
  await user.click(
    screen.getByRole('button', { name: `Edit ${secondTodo.title}` }),
  )
  await user.click(
    screen.getByRole('button', { name: `Delete ${secondTodo.title}` }),
  )

  expect(props.onToggle).toHaveBeenCalledTimes(1)
  expect(props.onToggle).toHaveBeenCalledWith(secondTodo)
  expect(props.onEdit).toHaveBeenCalledTimes(1)
  expect(props.onEdit).toHaveBeenCalledWith(secondTodo)
  expect(props.onDelete).toHaveBeenCalledTimes(1)
  expect(props.onDelete).toHaveBeenCalledWith(secondTodo)
})

it('forwards busy to every item', () => {
  setup({ todos: [todoFixture, secondTodo], hasTodos: true, busy: true })

  const buttons = screen.getAllByRole('button')

  expect(buttons).toHaveLength(6)
  buttons.forEach((button) => expect(button).toBeDisabled())
})

it('enables item actions when not busy', () => {
  setup({ todos: [todoFixture, secondTodo], hasTodos: true, busy: false })

  screen
    .getAllByRole('button')
    .forEach((button) => expect(button).toBeEnabled())
})

it('shows the unavailable message when loading failed and there are no cached todos', () => {
  setup({ failed: true, hasTodos: false, todos: [] })

  expect(
    screen.getByRole('heading', {
      name: 'The task list is temporarily unavailable',
    }),
  ).toBeVisible()
  expect(screen.getByText('Try again to load your tasks.')).toBeVisible()
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('keeps showing cached todos when a refetch fails', () => {
  setup({ failed: true, hasTodos: true, todos: [todoFixture] })

  expect(screen.getByText(todoFixture.title)).toBeVisible()
  expect(
    screen.queryByText('The task list is temporarily unavailable'),
  ).not.toBeInTheDocument()
})

it('shows the empty state instead of the error when failed but nothing matches the filters', async () => {
  const user = userEvent.setup()
  const props = setup({ failed: true, hasTodos: true, todos: [], busy: true })

  expect(
    screen.queryByText('The task list is temporarily unavailable'),
  ).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
  expect(screen.getByText('hasTodos: true')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(props.onCreate).not.toHaveBeenCalled()
})

it('wires onCreate to the empty state when enabled', async () => {
  const user = userEvent.setup()
  const props = setup({ failed: true, hasTodos: true, todos: [] })

  await user.click(screen.getByRole('button', { name: 'Create' }))

  expect(props.onCreate).toHaveBeenCalledTimes(1)
})
