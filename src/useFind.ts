import { useEffect } from 'react'

import { useContext } from './context'
import useStateMachine, { ResultType } from './state-machine'
import { useDeepMemo } from './utils'

/**
 * Set which index to use for the query. Or create one and use it. It can be:
 *
 * - "design-doc-name"
 * - ["design-doc-name", "name"]
 * - Object to create an index (the same options as db.createIndex).
 */
export type FindHookIndexOption =
  | string
  | [string, string]
  | {
      /**
       * List of fields to index
       */
      fields: string[]

      /**
       * Name of the index, auto-generated if you don't include it
       */
      name?: string

      /**
       * Design document name (i.e. the part after '_design/', auto-generated if you don't include it
       */
      ddoc?: string

      /**
       * Only supports 'json', and it's also the default
       */
      type?: string
    }

export interface FindHookOptions {
  /**
   * Set which index to use for the query. Or create one and use it. It can be:
   *
   * - "design-doc-name"
   * - ["design-doc-name", "name"]
   * - Object to create an index (the same options as db.createIndex).
   */
  index?: FindHookIndexOption

  /**
   * Defines a selector to filter the results. Required
   */
  selector: PouchDB.Find.Selector

  /**
   * Defines a list of fields that you want to receive. If omitted, you get the full documents.
   */
  fields?: string[]

  /**
   * Defines a list of fields defining how you want to sort.
   * Note that sorted fields also have to be selected in the selector.
   */
  sort?: Array<string | { [propName: string]: 'asc' | 'desc' }>

  /**
   * Maximum number of documents to return.
   */
  limit?: number

  /**
   * Number of docs to skip before returning.
   */
  skip?: number
}

export default function useFind<Content>(
  options: FindHookOptions
): ResultType<PouchDB.Find.FindResponse<Content>> {
  const { pouchdb: pouch, subscriptionManager } = useContext()

  if (
    typeof pouch?.createIndex !== 'function' ||
    typeof pouch?.find !== 'function'
  ) {
    throw new TypeError(
      'db.createIndex() or/and db.find() are not defined. Please install "pouchdb-find"'
    )
  }

  const index = useDeepMemo(options.index)
  const selector = useDeepMemo(options.selector)
  const fields = useDeepMemo(options.fields)
  const sort = useDeepMemo(options.sort)
  const limit = options.limit
  const skip = options.skip

  const [state, dispatch] = useStateMachine<PouchDB.Find.FindResponse<Content>>(
    () => ({
      docs: [],
    })
  )

  useEffect(() => {
    let isActive = true
    let name: string | undefined = undefined
    let ddoc: string | undefined = undefined

    const query = async () => {
      dispatch({ type: 'loading_started' })

      try {
        let indexToUse: string | [string, string] | undefined = undefined
        if (ddoc && name) {
          indexToUse = [ddoc, name]
        } else if (ddoc) {
          indexToUse = ddoc
        }

        const result = (await pouch.find({
          selector,
          fields,
          sort,
          limit,
          skip,
          use_index: indexToUse,
        })) as PouchDB.Find.FindResponse<Content>

        if (isActive) {
          dispatch({ type: 'loading_finished', payload: result })
        }
      } catch (error) {
        if (isActive) {
          dispatch({
            type: 'loading_error',
            payload: { error, setResult: false },
          })
        }
      }
    }

    query()

    return () => {
      isActive = false
    }
  }, [
    pouch,
    subscriptionManager,
    dispatch,
    index,
    selector,
    fields,
    sort,
    limit,
    skip,
  ])

  return state
}
