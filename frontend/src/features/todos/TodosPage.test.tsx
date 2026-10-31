import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { expect, it, vi } from 'vitest'
import type { SuccessNotice } from '../../components/SuccessNotice'
import { useNotice } from '../../hooks/useNotice'
import {
  errorMutation,
  idleMutation,
  loadingErrorQuery,
  pendingQuery,
  refetchErrorQuery,
  successQuery,
} from '../../test/queryResults'
import { todoFixture } from '../../test/todoFixture'
import type { DeleteTodoDialog } from './components/DeleteTodoDialog'
import type { TodoEditor } from './components/TodoEditor'
import type { TodoFilters } from './components/TodoFilters'
import type { TodoList } from './components/TodoList'
import type { TodosHeader } from './components/TodosHeader'
import type { Todo } from './types'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import { TodosPage } from './TodosPage'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./components/TodosHeader', () => ({
  TodosHeader: ({ disabled, onCreate }: ComponentProps<typeof TodosHeader>) => (
    <>
      <h1>Tasks</h1>
      <button disabled={disabled} onClick={onCreate}>
        Header create
      </button>
    </>
  ),
}))
vi.mock('./components/TodoFilters', () => ({
  TodoFilters: (props: ComponentProps<typeof TodoFilters>) => (
    <>
      <span>{`filter:${props.filter}`}</span>
      <span>{`search:${props.search}`}</span>
      <span>{`sort:${props.sort}`}</span>
      <span>{`due:${props.due}`}</span>
      <button onClick={() => props.onDueChange('week')}>Change due</button>
      <button onClick={() => props.onFilterChange('completed')}>
        Change filter
      </button>
      <button onClick={() => props.onSearchChange('bread')}>
        Change search
      </button>
      <button onClick={() => props.onSortChange('newest')}>Change sort</button>
    </>
  ),
}))
vi.mock('./components/TodoList', () => ({
  TodoList: (props: ComponentProps<typeof TodoList>) => (
    <>
      <p>Task list</p>
      <span>{`hasTodos:${props.hasTodos}`}</span>
      <span>{`loading:${props.loading}`}</span>
      <span>{`failed:${props.failed}`}</span>
      <span>{`busy:${props.busy}`}</span>
      <button onClick={props.onCreate}>List create</button>
      {props.todos.map((todo) => (
        <div key={todo.id}>
          <span>{`item:${todo.title}`}</span>
          <button onClick={() => props.onToggle(todo)}>
            {`Toggle ${todo.title}`}
          </button>
          <button onClick={() => props.onEdit(todo)}>
            {`Edit ${todo.title}`}
          </button>
          <button onClick={() => props.onDelete(todo)}>
            {`Delete ${todo.title}`}
          </button>
        </div>
      ))}
    </>
  ),
}))
vi.mock('./components/TodoEditor', () => ({
  TodoEditor: (props: ComponentProps<typeof TodoEditor>) => (
    <div role="dialog" aria-label="Editor">
      <span>{`editor-todo:${JSON.stringify(props.todo)}`}</span>
      <span>{`editor-busy:${props.busy}`}</span>
      <button onClick={props.onClose}>Close editor</button>
      <button onClick={() => props.onSaved('Task created.')}>
        Save editor
      </button>
    </div>
  ),
}))
vi.mock('./components/DeleteTodoDialog', () => ({
  DeleteTodoDialog: (props: ComponentProps<typeof DeleteTodoDialog>) => (
    <div role="dialog" aria-label="Delete">
      <span>{`delete-todo:${JSON.stringify(props.todo)}`}</span>
      <span>{`delete-busy:${props.busy}`}</span>
      <button onClick={props.onClose}>Close delete</button>
      <button onClick={props.onDeleted}>Confirm delete</button>
    </div>
  ),
}))
vi.mock('../../components/SuccessNotice', () => ({
  SuccessNotice: ({ message }: ComponentProps<typeof SuccessNotice>) => (
    <div role="status">{message}</div>
  ),
}))

type UpdateResult = ReturnType<typeof useUpdateTodoMutation>
type UpdateVariables = Parameters<UpdateResult['mutateAsync']>[0]

interface SetupOptions {
  query?: ReturnType<typeof useTodosQuery>
  mutation?: UpdateResult
  busy?: boolean
  visible?: Todo[]
  message?: string
  filters?: Partial<ReturnType<typeof useTodoFilters>>
}

function setup(options: SetupOptions = {}) {
  const notify = vi.fn()
  const filters: ReturnType<typeof useTodoFilters> = {
    filter: 'all',
    search: '',
    sort: 'newest',
    due: 'any',
    visible: options.visible ?? [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
    setDue: vi.fn(),
    ...options.filters,
  }
  vi.mocked(useTodosQuery).mockReturnValue(
    options.query ?? successQuery<Todo[]>([]),
  )
  vi.mocked(useUpdateTodoMutation).mockReturnValue(
    options.mutation ?? idleMutation<Todo, UpdateVariables>(),
  )
  vi.mocked(useTodosBusy).mockReturnValue(options.busy ?? false)
  vi.mocked(useNotice).mockReturnValue({
    message: options.message ?? '',
    notify,
  })
  vi.mocked(useTodoFilters).mockReturnValue(filters)
  return { notify, filters, user: userEvent.setup() }
}

const completedTodo: Todo = { ...todoFixture, completed: true }

it('marks an active task complete and announces it', async () => {
  const mutateAsync = vi
    .fn<UpdateResult['mutateAsync']>()
    .mockResolvedValue({ ...todoFixture, completed: true })
  const { notify, user } = setup({
    visible: [todoFixture],
    mutation: idleMutation<Todo, UpdateVariables>({ mutateAsync }),
  })
  render(<TodosPage />)

  await user.click(
    screen.getByRole('button', { name: `Toggle ${todoFixture.title}` }),
  )

  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith('Another task complete. Well done!'),
  )
  expect(mutateAsync).toHaveBeenCalledTimes(1)
  expect(mutateAsync).toHaveBeenCalledWith({
    id: todoFixture.id,
    input: { completed: true },
  })
  expect(notify).toHaveBeenCalledTimes(1)
})

it('marks a completed task as active and announces it', async () => {
  const mutateAsync = vi
    .fn<UpdateResult['mutateAsync']>()
    .mockResolvedValue(todoFixture)
  const { notify, user } = setup({
    visible: [completedTodo],
    mutation: idleMutation<Todo, UpdateVariables>({ mutateAsync }),
  })
  render(<TodosPage />)

  await user.click(
    screen.getByRole('button', { name: `Toggle ${todoFixture.title}` }),
  )

  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith('Task marked as active.'),
  )
  expect(mutateAsync).toHaveBeenCalledWith({
    id: todoFixture.id,
    input: { completed: false },
  })
  expect(notify).toHaveBeenCalledTimes(1)
})

it('ignores toggles while another mutation is busy', async () => {
  const mutateAsync = vi.fn<UpdateResult['mutateAsync']>()
  const { notify, user } = setup({
    busy: true,
    visible: [todoFixture],
    mutation: idleMutation<Todo, UpdateVariables>({ mutateAsync }),
  })
  render(<TodosPage />)

  await user.click(
    screen.getByRole('button', { name: `Toggle ${todoFixture.title}` }),
  )

  expect(mutateAsync).not.toHaveBeenCalled()
  expect(notify).not.toHaveBeenCalled()
})

it('swallows a failed toggle, shows no notice and shows the mutation error in the alert', async () => {
  const error = new Error('Update failed.')
  const variables = { id: todoFixture.id, input: { completed: true } }
  const mutateAsync = vi
    .fn<UpdateResult['mutateAsync']>()
    .mockRejectedValue(error)
  const { notify, user } = setup({
    visible: [todoFixture],
    mutation: errorMutation<Todo, UpdateVariables>(error, variables, {
      mutateAsync,
    }),
  })
  render(<TodosPage />)

  await user.click(
    screen.getByRole('button', { name: `Toggle ${todoFixture.title}` }),
  )

  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
  expect(notify).not.toHaveBeenCalled()
  expect(screen.getByTestId('alert')).toHaveTextContent('Update failed.')
})

it('shows the mutation error in preference to the query error', () => {
  setup({
    query: loadingErrorQuery<Todo[]>(new Error('Load failed.')),
    mutation: errorMutation<Todo, UpdateVariables>(
      new Error('Update failed.'),
      { id: todoFixture.id, input: { completed: true } },
    ),
  })

  render(<TodosPage />)

  expect(screen.getByTestId('alert')).toHaveTextContent('Update failed.')
  expect(screen.getByTestId('alert')).not.toHaveTextContent('Load failed.')
})

it.each([
  { isFetching: true, busy: false, disabled: true },
  { isFetching: false, busy: true, disabled: true },
  { isFetching: false, busy: false, disabled: false },
])(
  'sets Try again disabled to $disabled when isFetching is $isFetching and busy is $busy',
  ({ isFetching, busy, disabled }) => {
    setup({
      busy,
      query: loadingErrorQuery<Todo[]>(new Error('Load failed.'), {
        isFetching,
      }),
    })

    render(<TodosPage />)

    expect(screen.getByRole('button', { name: 'Try again' })).toHaveProperty(
      'disabled',
      disabled,
    )
  },
)

it('passes an empty list and the query and busy state to the list when data is not loaded yet', () => {
  setup({ query: pendingQuery<Todo[]>(), busy: true })

  render(<TodosPage />)

  expect(useTodoFilters).toHaveBeenCalledWith([])
  expect(screen.getByText('hasTodos:false')).toBeVisible()
  expect(screen.getByText('loading:true')).toBeVisible()
  expect(screen.getByText('failed:false')).toBeVisible()
  expect(screen.getByText('busy:true')).toBeVisible()
})

it('passes the todos from the query and hasTodos true when todos exist', () => {
  setup({ query: successQuery([todoFixture]), visible: [] })

  render(<TodosPage />)

  expect(useTodoFilters).toHaveBeenCalledWith([todoFixture])
  expect(screen.getByText('hasTodos:true')).toBeVisible()
  expect(screen.queryByText(/^item:/)).not.toBeInTheDocument()
})

it.each([
  { name: 'pending', pending: true, busy: false, disabled: true },
  { name: 'busy', pending: false, busy: true, disabled: true },
  { name: 'idle', pending: false, busy: false, disabled: false },
])(
  'sets the header create action disabled to $disabled when $name',
  ({ pending, busy, disabled }) => {
    setup({
      busy,
      query: pending ? pendingQuery<Todo[]>() : successQuery<Todo[]>([]),
    })

    render(<TodosPage />)

    expect(
      screen.getByRole('button', { name: 'Header create' }),
    ).toHaveProperty('disabled', disabled)
  },
)

it.each([
  { button: 'Header create', busy: false },
  { button: 'List create', busy: true },
])('opens the editor for a new task from $button', async ({ button, busy }) => {
  const { user } = setup({ busy })
  render(<TodosPage />)
  expect(screen.queryByRole('dialog', { name: 'Editor' })).toBeNull()

  await user.click(screen.getByRole('button', { name: button }))

  expect(screen.getByRole('dialog', { name: 'Editor' })).toBeVisible()
  expect(screen.getByText('editor-todo:"new"')).toBeVisible()
  expect(screen.getByText(`editor-busy:${busy}`)).toBeVisible()
})

it('opens the editor with the selected task when editing', async () => {
  const { user } = setup({ visible: [todoFixture] })
  render(<TodosPage />)

  await user.click(
    screen.getByRole('button', { name: `Edit ${todoFixture.title}` }),
  )

  expect(
    screen.getByText(`editor-todo:${JSON.stringify(todoFixture)}`),
  ).toBeVisible()
})

it('closes the editor on close without a notice, and closes it and announces the notice on save', async () => {
  const { notify, user } = setup()
  render(<TodosPage />)
  await user.click(screen.getByRole('button', { name: 'List create' }))

  await user.click(screen.getByRole('button', { name: 'Close editor' }))

  expect(screen.queryByRole('dialog', { name: 'Editor' })).toBeNull()
  expect(notify).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'List create' }))
  await user.click(screen.getByRole('button', { name: 'Save editor' }))

  expect(screen.queryByRole('dialog', { name: 'Editor' })).toBeNull()
  expect(notify).toHaveBeenCalledTimes(1)
  expect(notify).toHaveBeenCalledWith('Task created.')
})

it('opens the delete dialog for the chosen task and closes it on cancel without a notice', async () => {
  const { notify, user } = setup({ visible: [todoFixture], busy: true })
  render(<TodosPage />)
  expect(screen.queryByRole('dialog', { name: 'Delete' })).toBeNull()

  await user.click(
    screen.getByRole('button', { name: `Delete ${todoFixture.title}` }),
  )

  expect(screen.getByRole('dialog', { name: 'Delete' })).toBeVisible()
  expect(
    screen.getByText(`delete-todo:${JSON.stringify(todoFixture)}`),
  ).toBeVisible()
  expect(screen.getByText('delete-busy:true')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Close delete' }))

  expect(screen.queryByRole('dialog', { name: 'Delete' })).toBeNull()
  expect(notify).not.toHaveBeenCalled()
})

it("closes the delete dialog and announces 'Task deleted.' after deletion", async () => {
  const { notify, user } = setup({ visible: [todoFixture] })
  render(<TodosPage />)
  await user.click(
    screen.getByRole('button', { name: `Delete ${todoFixture.title}` }),
  )

  await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

  expect(screen.queryByRole('dialog', { name: 'Delete' })).toBeNull()
  expect(notify).toHaveBeenCalledTimes(1)
  expect(notify).toHaveBeenCalledWith('Task deleted.')
})

it('passes filter, search and sort to the filters and forwards each change callback to its own setter', async () => {
  const setFilter = vi.fn()
  const setSearch = vi.fn()
  const setSort = vi.fn()
  const { user } = setup({
    filters: {
      filter: 'active',
      search: 'milk',
      sort: 'due',
      setFilter,
      setSearch,
      setSort,
    },
  })
  render(<TodosPage />)
  expect(screen.getByText('filter:active')).toBeVisible()
  expect(screen.getByText('search:milk')).toBeVisible()
  expect(screen.getByText('sort:due')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Change filter' }))

  expect(setFilter).toHaveBeenCalledTimes(1)
  expect(setFilter).toHaveBeenCalledWith('completed')
  expect(setSearch).not.toHaveBeenCalled()
  expect(setSort).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Change search' }))

  expect(setSearch).toHaveBeenCalledTimes(1)
  expect(setSearch).toHaveBeenCalledWith('bread')
  expect(setFilter).toHaveBeenCalledTimes(1)
  expect(setSort).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Change sort' }))

  expect(setSort).toHaveBeenCalledTimes(1)
  expect(setSort).toHaveBeenCalledWith('newest')
  expect(setFilter).toHaveBeenCalledTimes(1)
  expect(setSearch).toHaveBeenCalledTimes(1)
})

it('passes the due filter to the filters and forwards its change callback to setDue', async () => {
  const setFilter = vi.fn()
  const setSearch = vi.fn()
  const setSort = vi.fn()
  const setDue = vi.fn()
  const { user } = setup({
    filters: { due: 'overdue', setFilter, setSearch, setSort, setDue },
  })
  render(<TodosPage />)
  expect(screen.getByText('due:overdue')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Change due' }))

  expect(setDue).toHaveBeenCalledTimes(1)
  expect(setDue).toHaveBeenCalledWith('week')
  expect(setFilter).not.toHaveBeenCalled()
  expect(setSearch).not.toHaveBeenCalled()
  expect(setSort).not.toHaveBeenCalled()
})

it('passes the notice message from useNotice to SuccessNotice', () => {
  setup({ message: 'Task created.' })

  render(<TodosPage />)

  expect(screen.getByRole('status')).toHaveTextContent('Task created.')
})

it('shows no notice text when the notice message is empty', () => {
  setup({ message: '' })

  render(<TodosPage />)

  expect(screen.getByRole('status')).toBeEmptyDOMElement()
})

it('displays a query failure and resets mutation errors before retrying', async () => {
  const user = userEvent.setup()
  const refetch = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue(
    refetchErrorQuery([], new Error('The server is unavailable.'), {
      refetch,
    }),
  )
  vi.mocked(useUpdateTodoMutation).mockReturnValue(
    idleMutation({ reset, mutateAsync: vi.fn() }),
  )
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify: vi.fn() })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    due: 'any',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
    setDue: vi.fn(),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'The server is unavailable.',
  )
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    refetch.mock.invocationCallOrder[0],
  )
})
