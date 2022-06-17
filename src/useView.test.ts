import PouchDB from 'pouchdb-core'
import memory from 'pouchdb-adapter-memory'
import mapReduce from 'pouchdb-mapreduce'

import {
  renderHook,
  renderHookWithMultiDbContext,
  act,
  waitForNextUpdate,
  DocWithAttachment,
} from './test-utils'
import useView from './useView'

PouchDB.plugin(memory)
PouchDB.plugin(mapReduce)

type TempView = PouchDB.Map<
  PouchDB.Core.Document<Record<string, unknown>>,
  unknown
>
type TempViewDoc = PouchDB.Filter<
  PouchDB.Core.Document<Record<string, unknown>>,
  unknown
>

let myPouch: PouchDB.Database

// mock for the view emit function
const emit = (key: unknown, value?: unknown) => {
  console.log('this is only for typescript and eslint', key, value)
}

beforeEach(() => {
  myPouch = new PouchDB('test', { adapter: 'memory' })
})

afterEach(async () => {
  await myPouch.destroy()
})

describe('temporary function only views', () => {
  test("should query a view and return it's result", async () => {
    await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'checker' },
    ])

    const view: TempView = (doc, emit) => {
      if (doc.type === 'tester') {
        emit?.(doc.test, 42)
      }
    }

    const { result } = renderHook(() => useView(view), {
      pouchdb: myPouch,
    })

    expect(result.current).toEqual({
      error: null,
      loading: true,
      state: 'loading',
      offset: 0,
      rows: [],
      total_rows: 0,
    })

    await waitForNextUpdate(result)

    expect(result.current).toEqual({
      error: null,
      loading: false,
      state: 'done',
      offset: 0,
      rows: [{ id: 'a', key: 'value', value: 42 }],
      total_rows: 1,
    })
  })

  test('should subscribe to changes to the view', async () => {
    const putResults = await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'checker' },
    ])

    const view: TempView = (doc, emit) => {
      if (doc.type === 'tester') {
        emit?.(doc.test, 42)
      }
    }

    const { result } = renderHook(() => useView(view), {
      pouchdb: myPouch,
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([{ id: 'a', key: 'value', value: 42 }])

    act(() => {
      myPouch.bulkDocs([
        { _id: 'c', test: 'Hallo!', type: 'tester' },
        { _id: 'd', test: 'world!', type: 'checker' },
      ])
    })

    expect(result.current.rows).toEqual([{ id: 'a', key: 'value', value: 42 }])

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([
      { id: 'c', key: 'Hallo!', value: 42 },
      { id: 'a', key: 'value', value: 42 },
    ])

    let secondUpdateRev = ''
    act(() => {
      myPouch
        .put({
          _id: 'a',
          _rev: putResults[0].rev,
          test: 'newValue',
          type: 'tester',
        })
        .then(result => {
          secondUpdateRev = result.rev
        })
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([
      { id: 'c', key: 'Hallo!', value: 42 },
      { id: 'a', key: 'newValue', value: 42 },
    ])

    act(() => {
      myPouch.put({
        _id: 'a',
        _rev: secondUpdateRev,
        test: 'newValue',
        type: 'otherType',
      })
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([{ id: 'c', key: 'Hallo!', value: 42 }])
  })

  test('should reload if a change did happen while a query did run', async () => {
    await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'checker' },
    ])

    const view: TempView = (doc, emit) => {
      if (doc.type === 'tester') {
        emit?.(doc.test, 42)
      }
    }

    const { result } = renderHook(() => useView(view), {
      pouchdb: myPouch,
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([{ id: 'a', key: 'value', value: 42 }])

    act(() => {
      myPouch.bulkDocs([
        { _id: 'c', test: 'Hallo!', type: 'tester' },
        { _id: 'd', test: 'world!', type: 'checker' },
      ])
    })

    expect(result.current.rows).toEqual([{ id: 'a', key: 'value', value: 42 }])

    act(() => {
      myPouch.bulkDocs([{ _id: 'e', test: 'Hallo!', type: 'tester' }])
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([
      { id: 'c', key: 'Hallo!', value: 42 },
      { id: 'e', key: 'Hallo!', value: 42 },
      { id: 'a', key: 'value', value: 42 },
    ])
  })

  test('should handle the deletion of docs in the result', async () => {
    const putResults = await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'tester' },
    ])

    const view: TempView = (doc, emit) => {
      if (doc.type === 'tester') {
        emit?.(doc.test, 42)
      }
    }

    const { result } = renderHook(() => useView(view), {
      initialProps: false,
      pouchdb: myPouch,
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([
      { id: 'b', key: 'other', value: 42 },
      { id: 'a', key: 'value', value: 42 },
    ])

    act(() => {
      myPouch.remove(putResults[0].id ?? 'fail', putResults[0].rev ?? 'fail')
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([{ id: 'b', key: 'other', value: 42 }])
  })

  describe('options', () => {
    test('should handle the include_docs option', async () => {
      const putResults = await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      }

      const { result, rerender } = renderHook(
        (include_docs: boolean) => useView(view, { include_docs }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        {
          doc: {
            _id: 'a',
            _rev: putResults[0].rev,
            test: 'value',
            type: 'tester',
          },
          id: 'a',
          key: 'value',
          value: 42,
        },
      ])
    })

    test('should handle the conflicts option', async () => {
      const putResults = await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const updateResult = await myPouch.put({
        _id: 'a',
        _rev: putResults[0].rev,
        test: 'update',
        type: 'tester',
      })

      const conflictResult = await myPouch.put(
        {
          _id: 'a',
          _rev: putResults[0].rev,
          test: 'conflict',
          type: 'tester',
        },
        { force: true }
      )

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      }

      const { result, rerender } = renderHook(
        (conflicts: boolean) =>
          useView(view, { include_docs: true, conflicts }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows[0].doc?._conflicts).toBeUndefined()

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows[0].doc?._conflicts).toEqual(
        result.current.rows[0].doc?._rev === updateResult.rev
          ? [conflictResult.rev]
          : [updateResult.rev]
      )
    })

    test('should handle the attachments option', async () => {
      await myPouch.bulkDocs([
        {
          _attachments: {
            'info.txt': {
              content_type: 'text/plain',
              data: Buffer.from('Is there life on Mars?\n'),
            },
          },
          _id: 'a',
          test: 'value',
          type: 'tester',
        },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      }

      const { result, rerender } = renderHook(
        (attachments: boolean) =>
          useView(view, { include_docs: true, attachments }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(
        (result.current.rows[0].doc as DocWithAttachment)._attachments[
          'info.txt'
        ]
      ).toEqual({
        content_type: 'text/plain',
        digest: 'md5-knhR9rrbyHqrdPJYmv/iAg==',
        length: 23,
        revpos: 1,
        stub: true,
      })

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(
        (result.current.rows[0].doc as DocWithAttachment)._attachments[
          'info.txt'
        ]
      ).toEqual({
        content_type: 'text/plain',
        data: 'SXMgdGhlcmUgbGlmZSBvbiBNYXJzPwo=',
        digest: 'md5-knhR9rrbyHqrdPJYmv/iAg==',
        revpos: 1,
      })
    })

    test('should handle the binary option', async () => {
      await myPouch.bulkDocs([
        {
          _attachments: {
            'info.txt': {
              content_type: 'text/plain',
              data: Buffer.from('Is there life on Mars?\n'),
            },
          },
          _id: 'a',
          test: 'value',
          type: 'tester',
        },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      }

      const { result, rerender } = renderHook(
        (binary: boolean) =>
          useView(view, { include_docs: true, attachments: true, binary }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(
        (result.current.rows[0].doc as DocWithAttachment)._attachments[
          'info.txt'
        ]
      ).toEqual({
        content_type: 'text/plain',
        data: 'SXMgdGhlcmUgbGlmZSBvbiBNYXJzPwo=',
        digest: 'md5-knhR9rrbyHqrdPJYmv/iAg==',
        revpos: 1,
      })

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(
        (result.current.rows[0].doc as DocWithAttachment)._attachments[
          'info.txt'
        ]
      ).toEqual({
        content_type: 'text/plain',
        data: Buffer.from('Is there life on Mars?\n'),
        digest: 'md5-knhR9rrbyHqrdPJYmv/iAg==',
        revpos: 1,
      })
    })

    test('should handle the startkey option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      }

      const { result, rerender } = renderHook(
        (startkey: unknown) => useView(view, { startkey }),
        {
          initialProps: 'x',
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
      ])

      rerender('a')

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
        { id: 'c', key: 'x-value', value: 42 },
      ])
    })

    test('should handle the endkey option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      }

      const { result, rerender } = renderHook(
        (endkey: unknown) => useView(view, { endkey }),
        {
          initialProps: 'value\uffff',
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender('a')

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([])
    })

    test("should not query if startkey or endkey are objects or arrays and their content didn't change", async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.([doc._id, doc.test], 42)
        }
      }

      const { result, rerender } = renderHook(
        ({ startkey, endkey }: { startkey: unknown; endkey: unknown }) =>
          useView(view, { startkey, endkey }),
        {
          initialProps: {
            startkey: ['b'],
            endkey: ['c'] as [string | Record<string, unknown>],
          },
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'b', key: ['b', 'other'], value: 42 },
      ])

      rerender({
        startkey: ['b'],
        endkey: ['c'],
      })

      expect(result.current.loading).toBe(false)

      rerender({
        startkey: ['b'],
        endkey: [{}],
      })

      expect(result.current.loading).toBe(true)
      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'b', key: ['b', 'other'], value: 42 },
        { id: 'c', key: ['c', 'x-value'], value: 42 },
      ])

      rerender({
        startkey: [''],
        endkey: [{}],
      })

      expect(result.current.loading).toBe(true)
      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: ['a', 'value'], value: 42 },
        { id: 'b', key: ['b', 'other'], value: 42 },
        { id: 'c', key: ['c', 'x-value'], value: 42 },
      ])
    })

    test('should handle the inclusive_end option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      }

      const { result, rerender } = renderHook(
        (inclusive_end: boolean) =>
          useView(view, { endkey: 'x-value', inclusive_end }),
        {
          initialProps: true,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
        { id: 'c', key: 'x-value', value: 42 },
      ])

      rerender(false)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])
    })

    test('should handle the limit option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      }

      const { result, rerender } = renderHook(
        (limit?: number) => useView(view, { limit }),
        {
          initialProps: 1,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender(5)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
        { id: 'c', key: 'x-value', value: 42 },
      ])
    })

    test('should handle the skip option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      }

      const { result, rerender } = renderHook(
        (skip?: number) => useView(view, { skip }),
        {
          initialProps: 1,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
      ])

      rerender(5)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([])
    })

    test('should handle the descending option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      }

      const { result, rerender } = renderHook(
        (descending: boolean) => useView(view, { descending }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
        { id: 'c', key: 'x-value', value: 42 },
      ])

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
        { id: 'a', key: 'value', value: 42 },
      ])
    })

    test('should handle the key option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      }

      const { result, rerender } = renderHook(
        (key: unknown) => useView(view, { key }),
        {
          initialProps: 'value',
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender('x-value')

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
      ])
    })

    test('should handle the keys option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      }

      const { result, rerender } = renderHook(
        (keys: unknown[]) => useView(view, { keys }),
        {
          initialProps: ['value'],
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender(['x-value', 'value'])

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
        { id: 'a', key: 'value', value: 42 },
      ])
    })

    test("should not query if key or keys are objects or arrays and their content didn't change", async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.([doc._id, doc.test], 42)
        }
      }

      const { result, rerender } = renderHook(
        (option: { key?: unknown; keys?: unknown[] }) => useView(view, option),
        {
          initialProps: {
            key: ['b', 'other'],
          },
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'b', key: ['b', 'other'], value: 42 },
      ])

      rerender({
        key: ['b', 'other'],
      })

      expect(result.current.loading).toBe(false)

      rerender({
        key: ['a', 'value'],
      })

      expect(result.current.loading).toBe(true)
      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: ['a', 'value'], value: 42 },
      ])

      rerender({
        keys: [
          ['a', 'value'],
          ['c', 'x-value'],
        ],
      })

      expect(result.current.loading).toBe(true)
      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: ['a', 'value'], value: 42 },
        { id: 'c', key: ['c', 'x-value'], value: 42 },
      ])

      rerender({
        keys: [
          ['a', 'value'],
          ['c', 'x-value'],
        ],
      })

      expect(result.current.loading).toBe(false)

      rerender({
        keys: [
          ['a', 'value'],
          ['b', 'other'],
        ],
      })

      expect(result.current.loading).toBe(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: ['a', 'value'], value: 42 },
        { id: 'b', key: ['b', 'other'], value: 42 },
      ])
    })

    test('should handle the update_seq option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
      ])

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      }

      const { result, rerender } = renderHook(
        (update_seq: boolean) => useView(view, { update_seq }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.update_seq).toBeUndefined()

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.update_seq).not.toBeUndefined()
    })

    test('should support the selection of a database in the context to be used', async () => {
      const other = new PouchDB('other', { adapter: 'memory' })

      await myPouch.put({
        _id: 'test',
        type: 'tester',
        value: 'myPouch',
      })

      await other.put({
        _id: 'test',
        type: 'tester',
        value: 'other',
      })

      const view: TempView = (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.type, doc.value)
        }
      }

      const { result, rerender } = renderHookWithMultiDbContext(
        (name?: string) => useView(view, { db: name }),
        {
          initialProps: undefined,
          main: myPouch,
          other: other,
        }
      )

      await waitForNextUpdate(result)

      // No db selection
      expect(result.current.loading).toBeFalsy()
      expect(result.current.rows).toEqual([
        {
          id: 'test',
          key: 'tester',
          value: 'myPouch',
        },
      ])

      // selecting a database that is not the default
      rerender('other')
      expect(result.current.loading).toBeTruthy()
      await waitForNextUpdate(result)

      expect(result.current.loading).toBeFalsy()
      expect(result.current.rows).toEqual([
        {
          id: 'test',
          key: 'tester',
          value: 'other',
        },
      ])

      // selecting the default db by it's name
      rerender('main')
      expect(result.current.loading).toBeTruthy()
      await waitForNextUpdate(result)

      expect(result.current.loading).toBeFalsy()
      expect(result.current.rows).toEqual([
        {
          id: 'test',
          key: 'tester',
          value: 'myPouch',
        },
      ])

      // reset to other db
      rerender('other')
      expect(result.current.loading).toBeTruthy()
      await waitForNextUpdate(result)

      // selecting by special _default key
      rerender('_default')
      await waitForNextUpdate(result)

      expect(result.current.rows).toEqual([
        {
          id: 'test',
          key: 'tester',
          value: 'myPouch',
        },
      ])

      await other.destroy()
    })
  })
})

describe('temporary views objects', () => {
  test("should query a view and return it's result", async () => {
    await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'checker' },
    ])

    const view: TempViewDoc = {
      map: (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      },
    }

    const { result } = renderHook(() => useView(view), {
      pouchdb: myPouch,
    })

    expect(result.current).toEqual({
      error: null,
      loading: true,
      state: 'loading',
      offset: 0,
      rows: [],
      total_rows: 0,
    })

    await waitForNextUpdate(result)

    expect(result.current).toEqual({
      error: null,
      loading: false,
      state: 'done',
      offset: 0,
      rows: [{ id: 'a', key: 'value', value: 42 }],
      total_rows: 1,
    })
  })

  test('should subscribe to changes to the view', async () => {
    const putResults = await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'checker' },
    ])

    const view: TempViewDoc = {
      map: (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      },
    }

    const { result } = renderHook(() => useView(view), {
      pouchdb: myPouch,
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([{ id: 'a', key: 'value', value: 42 }])

    act(() => {
      myPouch.bulkDocs([
        { _id: 'c', test: 'Hallo!', type: 'tester' },
        { _id: 'd', test: 'world!', type: 'checker' },
      ])
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([
      { id: 'c', key: 'Hallo!', value: 42 },
      { id: 'a', key: 'value', value: 42 },
    ])

    let secondUpdateRev = ''
    act(() => {
      myPouch
        .put({
          _id: 'a',
          _rev: putResults[0].rev,
          test: 'newValue',
          type: 'tester',
        })
        .then(result => {
          secondUpdateRev = result.rev
        })
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([
      { id: 'c', key: 'Hallo!', value: 42 },
      { id: 'a', key: 'newValue', value: 42 },
    ])

    act(() => {
      myPouch.put({
        _id: 'a',
        _rev: secondUpdateRev,
        test: 'newValue',
        type: 'otherType',
      })
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([{ id: 'c', key: 'Hallo!', value: 42 }])
  })

  test('should reload if a change did happen while a query did run', async () => {
    await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'checker' },
    ])

    const view: TempViewDoc = {
      map: (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      },
    }

    const { result } = renderHook(() => useView(view), {
      pouchdb: myPouch,
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([{ id: 'a', key: 'value', value: 42 }])

    act(() => {
      myPouch.bulkDocs([
        { _id: 'c', test: 'Hallo!', type: 'tester' },
        { _id: 'd', test: 'world!', type: 'checker' },
      ])
    })

    expect(result.current.rows).toEqual([{ id: 'a', key: 'value', value: 42 }])

    act(() => {
      myPouch.bulkDocs([{ _id: 'e', test: 'Hallo!', type: 'tester' }])
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([
      { id: 'c', key: 'Hallo!', value: 42 },
      { id: 'e', key: 'Hallo!', value: 42 },
      { id: 'a', key: 'value', value: 42 },
    ])
  })

  test('should handle the deletion of docs in the result', async () => {
    const putResults = await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'tester' },
    ])

    const view: TempViewDoc = {
      map: (doc, emit) => {
        if (doc.type === 'tester') {
          emit?.(doc.test, 42)
        }
      },
    }

    const { result } = renderHook(() => useView(view), {
      initialProps: false,
      pouchdb: myPouch,
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([
      { id: 'b', key: 'other', value: 42 },
      { id: 'a', key: 'value', value: 42 },
    ])

    act(() => {
      myPouch.remove(putResults[0].id ?? 'fail', putResults[0].rev ?? 'fail')
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([{ id: 'b', key: 'other', value: 42 }])
  })

  describe('options', () => {
    test('should handle the reduce option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
        reduce: '_count',
      }

      const { result, rerender } = renderHook(
        (reduce: boolean) => useView(view, { reduce }),
        {
          initialProps: true,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([{ key: null, value: 1 }])

      rerender(false)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])
    })

    test('should update if a doc is removed from the view while reducing', async () => {
      const [docAInfo, docBInfo] = await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
        reduce: '_count',
      }

      const { result, rerender } = renderHook(
        (reduce?: boolean) => useView(view, { reduce }),
        {
          initialProps: true,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.rows).toEqual([
        {
          key: null,
          value: 2,
        },
      ])

      await myPouch.remove(docBInfo.id ?? 'fail', docBInfo.rev ?? 'fail')

      await waitForNextUpdate(result)

      expect(result.current.rows).toEqual([
        {
          key: null,
          value: 1,
        },
      ])

      await myPouch.put({
        _id: docAInfo.id,
        _rev: docAInfo.rev,
        type: 'other',
        test: 'moar',
      })

      await waitForNextUpdate(result)

      expect(result.current.rows).toHaveLength(0)

      rerender()

      const [docCInfo, docDInfo] = await myPouch.bulkDocs([
        { _id: 'c', test: 'value', type: 'tester' },
        { _id: 'd', test: 'other', type: 'tester' },
      ])

      await waitForNextUpdate(result)

      expect(result.current.rows).toEqual([
        {
          key: null,
          value: 2,
        },
      ])

      await myPouch.remove(docCInfo.id ?? 'fail', docCInfo.rev ?? 'fail')

      await waitForNextUpdate(result)

      expect(result.current.rows).toEqual([
        {
          key: null,
          value: 1,
        },
      ])

      await myPouch.put({
        _id: docDInfo.id,
        _rev: docDInfo.rev,
        type: 'other',
        test: 'moar',
      })

      await waitForNextUpdate(result)

      expect(result.current.rows).toHaveLength(0)
    })

    test('should handle the include_docs option', async () => {
      const putResults = await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (include_docs: boolean) => useView(view, { include_docs }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        {
          doc: {
            _id: 'a',
            _rev: putResults[0].rev,
            test: 'value',
            type: 'tester',
          },
          id: 'a',
          key: 'value',
          value: 42,
        },
      ])
    })

    test('should handle the conflicts option', async () => {
      const putResults = await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const updateResult = await myPouch.put({
        _id: 'a',
        _rev: putResults[0].rev,
        test: 'update',
        type: 'tester',
      })

      const conflictResult = await myPouch.put(
        {
          _id: 'a',
          _rev: putResults[0].rev,
          test: 'conflict',
          type: 'tester',
        },
        { force: true }
      )

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (conflicts: boolean) =>
          useView(view, { include_docs: true, conflicts }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows[0].doc?._conflicts).toBeUndefined()

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows[0].doc?._conflicts).toEqual(
        result.current.rows[0].doc?._rev === updateResult.rev
          ? [conflictResult.rev]
          : [updateResult.rev]
      )
    })

    test('should handle the attachments option', async () => {
      await myPouch.bulkDocs([
        {
          _attachments: {
            'info.txt': {
              content_type: 'text/plain',
              data: Buffer.from('Is there life on Mars?\n'),
            },
          },
          _id: 'a',
          test: 'value',
          type: 'tester',
        },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (attachments: boolean) =>
          useView(view, { include_docs: true, attachments }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(
        (result.current.rows[0].doc as DocWithAttachment)._attachments[
          'info.txt'
        ]
      ).toEqual({
        content_type: 'text/plain',
        digest: 'md5-knhR9rrbyHqrdPJYmv/iAg==',
        length: 23,
        revpos: 1,
        stub: true,
      })

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(
        (result.current.rows[0].doc as DocWithAttachment)._attachments[
          'info.txt'
        ]
      ).toEqual({
        content_type: 'text/plain',
        data: 'SXMgdGhlcmUgbGlmZSBvbiBNYXJzPwo=',
        digest: 'md5-knhR9rrbyHqrdPJYmv/iAg==',
        revpos: 1,
      })
    })

    test('should handle the binary option', async () => {
      await myPouch.bulkDocs([
        {
          _attachments: {
            'info.txt': {
              content_type: 'text/plain',
              data: Buffer.from('Is there life on Mars?\n'),
            },
          },
          _id: 'a',
          test: 'value',
          type: 'tester',
        },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (binary: boolean) =>
          useView(view, { include_docs: true, attachments: true, binary }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(
        (result.current.rows[0].doc as DocWithAttachment)._attachments[
          'info.txt'
        ]
      ).toEqual({
        content_type: 'text/plain',
        data: 'SXMgdGhlcmUgbGlmZSBvbiBNYXJzPwo=',
        digest: 'md5-knhR9rrbyHqrdPJYmv/iAg==',
        revpos: 1,
      })

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(
        (result.current.rows[0].doc as DocWithAttachment)._attachments[
          'info.txt'
        ]
      ).toEqual({
        content_type: 'text/plain',
        data: Buffer.from('Is there life on Mars?\n'),
        digest: 'md5-knhR9rrbyHqrdPJYmv/iAg==',
        revpos: 1,
      })
    })

    test('should handle the startkey option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (startkey: unknown) => useView(view, { startkey }),
        {
          initialProps: 'x',
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
      ])

      rerender('a')

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
        { id: 'c', key: 'x-value', value: 42 },
      ])
    })

    test('should handle the endkey option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (endkey: unknown) => useView(view, { endkey }),
        {
          initialProps: 'value\uffff',
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender('a')

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([])
    })

    test("should not query if startkey or endkey are objects or arrays and their content didn't change", async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.([doc._id, doc.test], 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        ({ startkey, endkey }: { startkey: unknown; endkey: unknown }) =>
          useView(view, { startkey, endkey }),
        {
          initialProps: {
            startkey: ['b'],
            endkey: ['c'] as [string | Record<string, unknown>],
          },
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'b', key: ['b', 'other'], value: 42 },
      ])

      rerender({
        startkey: ['b'],
        endkey: ['c'],
      })

      expect(result.current.loading).toBe(false)

      rerender({
        startkey: ['b'],
        endkey: [{}],
      })

      expect(result.current.loading).toBe(true)
      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'b', key: ['b', 'other'], value: 42 },
        { id: 'c', key: ['c', 'x-value'], value: 42 },
      ])

      rerender({
        startkey: [''],
        endkey: [{}],
      })

      expect(result.current.loading).toBe(true)
      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: ['a', 'value'], value: 42 },
        { id: 'b', key: ['b', 'other'], value: 42 },
        { id: 'c', key: ['c', 'x-value'], value: 42 },
      ])
    })

    test('should handle the inclusive_end option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (inclusive_end: boolean) =>
          useView(view, { endkey: 'x-value', inclusive_end }),
        {
          initialProps: true,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
        { id: 'c', key: 'x-value', value: 42 },
      ])

      rerender(false)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])
    })

    test('should handle the limit option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (limit?: number) => useView(view, { limit }),
        {
          initialProps: 1,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender(5)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
        { id: 'c', key: 'x-value', value: 42 },
      ])
    })

    test('should handle the skip option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (skip?: number) => useView(view, { skip }),
        {
          initialProps: 1,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
      ])

      rerender(5)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([])
    })

    test('should handle the descending option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (descending: boolean) => useView(view, { descending }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
        { id: 'c', key: 'x-value', value: 42 },
      ])

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
        { id: 'a', key: 'value', value: 42 },
      ])
    })

    test('should handle the key option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (key: unknown) => useView(view, { key }),
        {
          initialProps: 'value',
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender('x-value')

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
      ])
    })

    test('should handle the keys option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (keys: unknown[]) => useView(view, { keys }),
        {
          initialProps: ['value'],
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender(['x-value', 'value'])

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
        { id: 'a', key: 'value', value: 42 },
      ])
    })

    test('should handle the group option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'value', type: 'tester' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.test, 42)
          }
        },
        reduce: '_count',
      }

      const { result, rerender } = renderHook(
        (group: boolean) => useView(view, { group }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([{ key: null, value: 3 }])

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { key: 'value', value: 2 },
        { key: 'x-value', value: 1 },
      ])
    })

    test('should handle the group_level option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'value', type: 'tester' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.([13, doc.test], 42)
          }
        },
        reduce: '_count',
      }

      const { result, rerender } = renderHook(
        (group_level: number) => useView(view, { group_level }),
        {
          initialProps: 1,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([{ key: [13], value: 3 }])

      rerender(2)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { key: [13, 'value'], value: 2 },
        { key: [13, 'x-value'], value: 1 },
      ])
    })

    test("should not query if key or keys are objects or arrays and their content didn't change", async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.([doc._id, doc.test], 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (option: { key?: unknown; keys?: unknown[] }) => useView(view, option),
        {
          initialProps: {
            key: ['b', 'other'],
          },
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'b', key: ['b', 'other'], value: 42 },
      ])

      rerender({
        key: ['b', 'other'],
      })

      expect(result.current.loading).toBe(false)

      rerender({
        key: ['a', 'value'],
      })

      expect(result.current.loading).toBe(true)
      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: ['a', 'value'], value: 42 },
      ])

      rerender({
        keys: [
          ['a', 'value'],
          ['c', 'x-value'],
        ],
      })

      expect(result.current.loading).toBe(true)
      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: ['a', 'value'], value: 42 },
        { id: 'c', key: ['c', 'x-value'], value: 42 },
      ])

      rerender({
        keys: [
          ['a', 'value'],
          ['c', 'x-value'],
        ],
      })

      expect(result.current.loading).toBe(false)

      rerender({
        keys: [
          ['a', 'value'],
          ['b', 'other'],
        ],
      })

      expect(result.current.loading).toBe(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: ['a', 'value'], value: 42 },
        { id: 'b', key: ['b', 'other'], value: 42 },
      ])
    })

    test('should handle the update_seq option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
      ])

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.([doc._id, doc.test], 42)
          }
        },
      }

      const { result, rerender } = renderHook(
        (update_seq: boolean) => useView(view, { update_seq }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.update_seq).toBeUndefined()

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.update_seq).not.toBeUndefined()
    })

    test('should support the selection of a database in the context to be used', async () => {
      const other = new PouchDB('other', { adapter: 'memory' })

      await myPouch.put({
        _id: 'test',
        type: 'tester',
        value: 'myPouch',
      })

      await other.put({
        _id: 'test',
        type: 'tester',
        value: 'other',
      })

      const view: TempViewDoc = {
        map: (doc, emit) => {
          if (doc.type === 'tester') {
            emit?.(doc.type, doc.value)
          }
        },
      }

      const { result, rerender } = renderHookWithMultiDbContext(
        (name?: string) => useView(view, { db: name }),
        {
          initialProps: undefined,
          main: myPouch,
          other: other,
        }
      )

      await waitForNextUpdate(result)

      // No db selection
      expect(result.current.loading).toBeFalsy()
      expect(result.current.rows).toEqual([
        {
          id: 'test',
          key: 'tester',
          value: 'myPouch',
        },
      ])

      // selecting a database that is not the default
      rerender('other')
      expect(result.current.loading).toBeTruthy()
      await waitForNextUpdate(result)

      expect(result.current.loading).toBeFalsy()
      expect(result.current.rows).toEqual([
        {
          id: 'test',
          key: 'tester',
          value: 'other',
        },
      ])

      // selecting the default db by it's name
      rerender('main')
      expect(result.current.loading).toBeTruthy()
      await waitForNextUpdate(result)

      expect(result.current.loading).toBeFalsy()
      expect(result.current.rows).toEqual([
        {
          id: 'test',
          key: 'tester',
          value: 'myPouch',
        },
      ])

      // reset to other db
      rerender('other')
      expect(result.current.loading).toBeTruthy()
      await waitForNextUpdate(result)

      // selecting by special _default key
      rerender('_default')
      await waitForNextUpdate(result)

      expect(result.current.rows).toEqual([
        {
          id: 'test',
          key: 'tester',
          value: 'myPouch',
        },
      ])

      await other.destroy()
    })
  })
})

describe('design documents', () => {
  test('should query a view from a design document', async () => {
    await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'checker' },
    ])

    const ddoc = {
      _id: '_design/ddoc',
      views: {
        test: {
          map: function (doc: PouchDB.Core.Document<Record<string, unknown>>) {
            if (doc.type === 'tester') {
              emit(doc.test, 42)
            }
          }.toString(),
        },
      },
    }

    await myPouch.put(ddoc)

    const { result } = renderHook(() => useView('ddoc/test'), {
      pouchdb: myPouch,
    })

    expect(result.current).toEqual({
      error: null,
      loading: true,
      state: 'loading',
      offset: 0,
      rows: [],
      total_rows: 0,
    })

    await waitForNextUpdate(result)

    expect(result.current).toEqual({
      error: null,
      loading: false,
      state: 'done',
      offset: 0,
      rows: [{ id: 'a', key: 'value', value: 42 }],
      total_rows: 1,
    })
  })

  test("should result in an error if the view doesn't exist", async () => {
    await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'checker' },
    ])

    const { result } = renderHook(() => useView('view'), {
      pouchdb: myPouch,
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('error')
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.status).toBe(404)
    expect(result.current.error?.message).toBe('missing')
    expect(result.current.rows).toEqual([])
  })

  test('should subscribe to changes to the view', async () => {
    const putResults = await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'checker' },
    ])

    const ddoc = {
      _id: '_design/ddoc',
      views: {
        test: {
          map: function (doc: PouchDB.Core.Document<Record<string, unknown>>) {
            if (doc.type === 'tester') {
              emit(doc.test, 42)
            }
          }.toString(),
        },
      },
    }

    await myPouch.put(ddoc)

    const { result } = renderHook(() => useView('ddoc/test'), {
      pouchdb: myPouch,
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([{ id: 'a', key: 'value', value: 42 }])

    act(() => {
      myPouch.bulkDocs([
        { _id: 'c', test: 'Hallo!', type: 'tester' },
        { _id: 'd', test: 'world!', type: 'checker' },
      ])
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([
      { id: 'c', key: 'Hallo!', value: 42 },
      { id: 'a', key: 'value', value: 42 },
    ])

    let secondUpdateRev = ''
    act(() => {
      myPouch
        .put({
          _id: 'a',
          _rev: putResults[0].rev,
          test: 'newValue',
          type: 'tester',
        })
        .then(result => {
          secondUpdateRev = result.rev
        })
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([
      { id: 'c', key: 'Hallo!', value: 42 },
      { id: 'a', key: 'newValue', value: 42 },
    ])

    act(() => {
      myPouch.put({
        _id: 'a',
        _rev: secondUpdateRev,
        test: 'newValue',
        type: 'otherType',
      })
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([{ id: 'c', key: 'Hallo!', value: 42 }])
  })

  test('should result in an error if the ddoc gets deleted', async () => {
    await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'checker' },
    ])

    const ddoc = {
      _id: '_design/ddoc',
      views: {
        test: {
          map: function (doc: PouchDB.Core.Document<Record<string, unknown>>) {
            if (doc.type === 'tester') {
              emit(doc.test, 42)
            }
          }.toString(),
        },
      },
    }

    const ddocResult = await myPouch.put(ddoc)

    const { result } = renderHook(() => useView('ddoc/test'), {
      pouchdb: myPouch,
    })

    await waitForNextUpdate(result)

    act(() => {
      myPouch.remove(ddocResult.id, ddocResult.rev)
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('error')
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.status).toBe(404)
    expect(result.current.error?.message).toBe('missing')
    expect(result.current.rows).toEqual([])
  })

  test("should query a view if the ddoc didn't exist but is then created", async () => {
    await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'checker' },
    ])

    const ddoc = {
      _id: '_design/ddoc',
      views: {
        test: {
          map: function (doc: PouchDB.Core.Document<Record<string, unknown>>) {
            if (doc.type === 'tester') {
              emit(doc.test, 42)
            }
          }.toString(),
        },
      },
    }

    const { result } = renderHook(() => useView('ddoc/test'), {
      pouchdb: myPouch,
    })

    await waitForNextUpdate(result)

    await myPouch.put(ddoc)

    await waitForNextUpdate(result)

    expect(result.current).toEqual({
      error: null,
      loading: false,
      state: 'done',
      offset: 0,
      rows: [{ id: 'a', key: 'value', value: 42 }],
      total_rows: 1,
    })
  })

  test('should reload if a change did happen while a query did run', async () => {
    await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'checker' },
    ])

    const ddoc = {
      _id: '_design/ddoc',
      views: {
        test: {
          map: function (doc: PouchDB.Core.Document<Record<string, unknown>>) {
            if (doc.type === 'tester') {
              emit(doc.test, 42)
            }
          }.toString(),
        },
      },
    }

    await myPouch.put(ddoc)

    const { result } = renderHook(() => useView('ddoc/test'), {
      pouchdb: myPouch,
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([{ id: 'a', key: 'value', value: 42 }])

    act(() => {
      myPouch.bulkDocs([
        { _id: 'c', test: 'Hallo!', type: 'tester' },
        { _id: 'd', test: 'world!', type: 'checker' },
      ])
    })

    await waitForNextUpdate(result)

    act(() => {
      myPouch.bulkDocs([{ _id: 'e', test: 'Hallo!', type: 'tester' }])
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([
      { id: 'c', key: 'Hallo!', value: 42 },
      { id: 'e', key: 'Hallo!', value: 42 },
      { id: 'a', key: 'value', value: 42 },
    ])
  })

  test('should handle the deletion of docs in the result', async () => {
    const putResults = await myPouch.bulkDocs([
      { _id: 'a', test: 'value', type: 'tester' },
      { _id: 'b', test: 'other', type: 'tester' },
    ])

    const ddoc = {
      _id: '_design/ddoc',
      views: {
        test: {
          map: function (doc: PouchDB.Core.Document<Record<string, unknown>>) {
            if (doc.type === 'tester') {
              emit(doc.test, 42)
            }
          }.toString(),
        },
      },
    }

    await myPouch.put(ddoc)

    const { result } = renderHook(() => useView('ddoc/test'), {
      initialProps: false,
      pouchdb: myPouch,
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([
      { id: 'b', key: 'other', value: 42 },
      { id: 'a', key: 'value', value: 42 },
    ])

    act(() => {
      myPouch.remove(putResults[0].id ?? 'fail', putResults[0].rev ?? 'fail')
    })

    await waitForNextUpdate(result)

    expect(result.current.state).toBe('done')
    expect(result.current.rows).toEqual([{ id: 'b', key: 'other', value: 42 }])
  })

  describe('options', () => {
    test('should handle the reduce option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
            reduce: '_count',
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (reduce: boolean) => useView('ddoc/test', { reduce }),
        {
          initialProps: true,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([{ key: null, value: 1 }])

      rerender(false)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])
    })

    test('should update if a doc is removed from the view while reducing', async () => {
      const [docAInfo, docBInfo] = await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
            reduce: '_count',
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (reduce?: boolean) => useView('ddoc/test', { reduce }),
        {
          initialProps: true,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.rows).toEqual([
        {
          key: null,
          value: 2,
        },
      ])

      await myPouch.remove(docBInfo.id ?? 'fail', docBInfo.rev ?? 'fail')

      await waitForNextUpdate(result)

      expect(result.current.rows).toEqual([
        {
          key: null,
          value: 1,
        },
      ])

      await myPouch.put({
        _id: docAInfo.id,
        _rev: docAInfo.rev,
        type: 'other',
        test: 'moar',
      })

      await waitForNextUpdate(result)

      expect(result.current.rows).toHaveLength(0)

      rerender()

      const [docCInfo, docDInfo] = await myPouch.bulkDocs([
        { _id: 'c', test: 'value', type: 'tester' },
        { _id: 'd', test: 'other', type: 'tester' },
      ])

      await waitForNextUpdate(result)

      expect(result.current.rows).toEqual([
        {
          key: null,
          value: 2,
        },
      ])

      await myPouch.remove(docCInfo.id ?? 'fail', docCInfo.rev ?? 'fail')

      await waitForNextUpdate(result)

      expect(result.current.rows).toEqual([
        {
          key: null,
          value: 1,
        },
      ])

      await myPouch.put({
        _id: docDInfo.id,
        _rev: docDInfo.rev,
        type: 'other',
        test: 'moar',
      })

      await waitForNextUpdate(result)

      expect(result.current.rows).toHaveLength(0)
    })

    test('should handle the include_docs option', async () => {
      const putResults = await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (include_docs: boolean) => useView('ddoc/test', { include_docs }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        {
          doc: {
            _id: 'a',
            _rev: putResults[0].rev,
            test: 'value',
            type: 'tester',
          },
          id: 'a',
          key: 'value',
          value: 42,
        },
      ])
    })

    test('should handle the conflicts option', async () => {
      const putResults = await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const updateResult = await myPouch.put({
        _id: 'a',
        _rev: putResults[0].rev,
        test: 'update',
        type: 'tester',
      })

      const conflictResult = await myPouch.put(
        {
          _id: 'a',
          _rev: putResults[0].rev,
          test: 'conflict',
          type: 'tester',
        },
        { force: true }
      )

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (conflicts: boolean) =>
          useView('ddoc/test', { include_docs: true, conflicts }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows[0].doc?._conflicts).toBeUndefined()

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows[0].doc?._conflicts).toEqual(
        result.current.rows[0].doc?._rev === updateResult.rev
          ? [conflictResult.rev]
          : [updateResult.rev]
      )
    })

    test('should handle the attachments option', async () => {
      await myPouch.bulkDocs([
        {
          _attachments: {
            'info.txt': {
              content_type: 'text/plain',
              data: Buffer.from('Is there life on Mars?\n'),
            },
          },
          _id: 'a',
          test: 'value',
          type: 'tester',
        },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (attachments: boolean) =>
          useView('ddoc/test', { include_docs: true, attachments }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(
        (result.current.rows[0].doc as DocWithAttachment)._attachments[
          'info.txt'
        ]
      ).toEqual({
        content_type: 'text/plain',
        digest: 'md5-knhR9rrbyHqrdPJYmv/iAg==',
        length: 23,
        revpos: 1,
        stub: true,
      })

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(
        (result.current.rows[0].doc as DocWithAttachment)._attachments[
          'info.txt'
        ]
      ).toEqual({
        content_type: 'text/plain',
        data: 'SXMgdGhlcmUgbGlmZSBvbiBNYXJzPwo=',
        digest: 'md5-knhR9rrbyHqrdPJYmv/iAg==',
        revpos: 1,
      })
    })

    test('should handle the binary option', async () => {
      await myPouch.bulkDocs([
        {
          _attachments: {
            'info.txt': {
              content_type: 'text/plain',
              data: Buffer.from('Is there life on Mars?\n'),
            },
          },
          _id: 'a',
          test: 'value',
          type: 'tester',
        },
        { _id: 'b', test: 'other', type: 'checker' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (binary: boolean) =>
          useView('ddoc/test', {
            include_docs: true,
            attachments: true,
            binary,
          }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(
        (result.current.rows[0].doc as DocWithAttachment)._attachments[
          'info.txt'
        ]
      ).toEqual({
        content_type: 'text/plain',
        data: 'SXMgdGhlcmUgbGlmZSBvbiBNYXJzPwo=',
        digest: 'md5-knhR9rrbyHqrdPJYmv/iAg==',
        revpos: 1,
      })

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(
        (result.current.rows[0].doc as DocWithAttachment)._attachments[
          'info.txt'
        ]
      ).toEqual({
        content_type: 'text/plain',
        data: Buffer.from('Is there life on Mars?\n'),
        digest: 'md5-knhR9rrbyHqrdPJYmv/iAg==',
        revpos: 1,
      })
    })

    test('should handle the startkey option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (startkey: unknown) => useView('ddoc/test', { startkey }),
        {
          initialProps: 'x',
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
      ])

      rerender('a')

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
        { id: 'c', key: 'x-value', value: 42 },
      ])
    })

    test('should handle the endkey option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (endkey: unknown) => useView('ddoc/test', { endkey }),
        {
          initialProps: 'value\uffff',
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender('a')

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([])
    })

    test("should not query if startkey or endkey are objects or arrays and their content didn't change", async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit([doc._id, doc.test], 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        ({ startkey, endkey }: { startkey: unknown; endkey: unknown }) =>
          useView('ddoc/test', { startkey, endkey }),
        {
          initialProps: {
            startkey: ['b'],
            endkey: ['c'] as [string | Record<string, unknown>],
          },
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'b', key: ['b', 'other'], value: 42 },
      ])

      rerender({
        startkey: ['b'],
        endkey: ['c'],
      })

      expect(result.current.loading).toBe(false)

      rerender({
        startkey: ['b'],
        endkey: [{}],
      })

      expect(result.current.loading).toBe(true)
      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'b', key: ['b', 'other'], value: 42 },
        { id: 'c', key: ['c', 'x-value'], value: 42 },
      ])

      rerender({
        startkey: [''],
        endkey: [{}],
      })

      expect(result.current.loading).toBe(true)
      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: ['a', 'value'], value: 42 },
        { id: 'b', key: ['b', 'other'], value: 42 },
        { id: 'c', key: ['c', 'x-value'], value: 42 },
      ])
    })

    test('should handle the inclusive_end option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (inclusive_end: boolean) =>
          useView('ddoc/test', { endkey: 'x-value', inclusive_end }),
        {
          initialProps: true,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
        { id: 'c', key: 'x-value', value: 42 },
      ])

      rerender(false)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])
    })

    test('should handle the limit option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (limit?: number) => useView('ddoc/test', { limit }),
        {
          initialProps: 1,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender(5)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
        { id: 'c', key: 'x-value', value: 42 },
      ])
    })

    test('should handle the skip option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (skip?: number) => useView('ddoc/test', { skip }),
        {
          initialProps: 1,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
      ])

      rerender(5)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([])
    })

    test('should handle the descending option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (descending: boolean) => useView('ddoc/test', { descending }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
        { id: 'c', key: 'x-value', value: 42 },
      ])

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
        { id: 'a', key: 'value', value: 42 },
      ])
    })

    test('should handle the key option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'checker' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (key: unknown) => useView('ddoc/test', { key }),
        {
          initialProps: 'value',
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender('x-value')

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
      ])
    })

    test('should handle the keys option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (keys: unknown[]) => useView('ddoc/test', { keys }),
        {
          initialProps: ['value'],
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: 'value', value: 42 },
      ])

      rerender(['x-value', 'value'])

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'c', key: 'x-value', value: 42 },
        { id: 'a', key: 'value', value: 42 },
      ])
    })

    test('should handle the group option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'value', type: 'tester' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.test, 42)
              }
            }.toString(),
            reduce: '_count',
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (group: boolean) => useView('ddoc/test', { group }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([{ key: null, value: 3 }])

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { key: 'value', value: 2 },
        { key: 'x-value', value: 1 },
      ])
    })

    test('should handle the group_level option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'value', type: 'tester' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit([13, doc.test], 42)
              }
            }.toString(),
            reduce: '_count',
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (group_level: number) => useView('ddoc/test', { group_level }),
        {
          initialProps: 1,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([{ key: [13], value: 3 }])

      rerender(2)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { key: [13, 'value'], value: 2 },
        { key: [13, 'x-value'], value: 1 },
      ])
    })

    test("should not query if key or keys are objects or arrays and their content didn't change", async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
        { _id: 'c', test: 'x-value', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit([doc._id, doc.test], 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (option: { key?: unknown; keys?: unknown[] }) =>
          useView('ddoc/test', option),
        {
          initialProps: {
            key: ['b', 'other'],
          },
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'b', key: ['b', 'other'], value: 42 },
      ])

      rerender({
        key: ['b', 'other'],
      })

      expect(result.current.loading).toBe(false)

      rerender({
        key: ['a', 'value'],
      })

      expect(result.current.loading).toBe(true)
      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: ['a', 'value'], value: 42 },
      ])

      rerender({
        keys: [
          ['a', 'value'],
          ['c', 'x-value'],
        ],
      })

      expect(result.current.loading).toBe(true)
      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: ['a', 'value'], value: 42 },
        { id: 'c', key: ['c', 'x-value'], value: 42 },
      ])

      rerender({
        keys: [
          ['a', 'value'],
          ['c', 'x-value'],
        ],
      })

      expect(result.current.loading).toBe(false)

      rerender({
        keys: [
          ['a', 'value'],
          ['b', 'other'],
        ],
      })

      expect(result.current.loading).toBe(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.rows).toEqual([
        { id: 'a', key: ['a', 'value'], value: 42 },
        { id: 'b', key: ['b', 'other'], value: 42 },
      ])
    })

    test('should handle the update_seq option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit([doc._id, doc.test], 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      const { result, rerender } = renderHook(
        (update_seq: boolean) => useView('ddoc/test', { update_seq }),
        {
          initialProps: false,
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.update_seq).toBeUndefined()

      rerender(true)

      await waitForNextUpdate(result)

      expect(result.current.state).toBe('done')
      expect(result.current.update_seq).not.toBeUndefined()
    })

    test('should handle the stale option', async () => {
      await myPouch.bulkDocs([
        { _id: 'a', test: 'value', type: 'tester' },
        { _id: 'b', test: 'other', type: 'tester' },
      ])

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit([doc._id, doc.test], 42)
              }
            }.toString(),
          },
        },
      }

      await myPouch.put(ddoc)

      await myPouch.bulkDocs([
        { _id: 'c', test: 'moar', type: 'tester' },
        { _id: 'd', test: 'OK', type: 'tester' },
      ])

      const { result } = renderHook(
        (stale?: 'ok') => useView('ddoc/test', { stale }),
        {
          initialProps: 'ok',
          pouchdb: myPouch,
        }
      )

      await waitForNextUpdate(result)

      expect(result.current.loading).toBeFalsy()
      expect(result.current.state).toBe('done')
      expect(result.current.total_rows).toBe(4)
      expect(result.current.rows).toHaveLength(4)
      expect(result.current.rows.map(row => row.id)).toEqual([
        'a',
        'b',
        'c',
        'd',
      ])
    })

    test('should support the selection of a database in the context to be used', async () => {
      const other = new PouchDB('other', { adapter: 'memory' })

      const ddoc = {
        _id: '_design/ddoc',
        views: {
          test: {
            map: function (
              doc: PouchDB.Core.Document<Record<string, unknown>>
            ) {
              if (doc.type === 'tester') {
                emit(doc.type, doc.value)
              }
            }.toString(),
          },
        },
      }

      await myPouch.bulkDocs([
        ddoc,
        {
          _id: 'test',
          type: 'tester',
          value: 'myPouch',
        },
      ])

      await other.bulkDocs([
        ddoc,
        {
          _id: 'test',
          type: 'tester',
          value: 'other',
        },
      ])

      const { result, rerender } = renderHookWithMultiDbContext(
        (name?: string) => useView('ddoc/test', { db: name }),
        {
          initialProps: undefined,
          main: myPouch,
          other: other,
        }
      )

      await waitForNextUpdate(result)

      // No db selection
      expect(result.current.loading).toBeFalsy()
      expect(result.current.rows).toEqual([
        {
          id: 'test',
          key: 'tester',
          value: 'myPouch',
        },
      ])

      // selecting a database that is not the default
      rerender('other')
      expect(result.current.loading).toBeTruthy()
      await waitForNextUpdate(result)

      expect(result.current.loading).toBeFalsy()
      expect(result.current.rows).toEqual([
        {
          id: 'test',
          key: 'tester',
          value: 'other',
        },
      ])

      // selecting the default db by it's name
      rerender('main')
      expect(result.current.loading).toBeTruthy()
      await waitForNextUpdate(result)

      expect(result.current.loading).toBeFalsy()
      expect(result.current.rows).toEqual([
        {
          id: 'test',
          key: 'tester',
          value: 'myPouch',
        },
      ])

      // reset to other db
      rerender('other')
      expect(result.current.loading).toBeTruthy()
      await waitForNextUpdate(result)

      // selecting by special _default key
      rerender('_default')
      await waitForNextUpdate(result)

      expect(result.current.rows).toEqual([
        {
          id: 'test',
          key: 'tester',
          value: 'myPouch',
        },
      ])

      await other.destroy()
    })
  })
})
