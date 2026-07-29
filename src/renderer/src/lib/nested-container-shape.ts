/**
 * Shape classification for the nested collection size walker.
 *
 * Two questions, both answered without reading a single user VALUE: is this
 * object safe to walk at all, and are its keys field names (safe to print) or
 * user data (must be collapsed to `[]`)? The second question is a privacy
 * boundary — walker output is uploaded with crash reports — so it lives here
 * rather than inline, where it is easy to test in isolation.
 */

/** Entries sampled to decide dictionary-vs-struct; shape is uniform, so few suffice. */
export const HOMOGENEITY_SAMPLE = 8

/**
 * Strict lowerCamelCase, the convention every field name in this store follows.
 * Deliberately narrower than "valid identifier": it rejects the shapes user data
 * actually takes — snake_case and kebab branch names, paths, UUIDs, SCREAMING
 * keys — so a one-entry dictionary cannot smuggle a key into a Slack-bound
 * breadcrumb on the one path where repeated-shape detection has nothing to
 * compare against. A rejected key costs a label; an accepted one costs a leak.
 */
const NAMED_PROPERTY_KEY = /^[a-z][A-Za-z0-9]{0,31}$/

export function isFieldNameShaped(key: string): boolean {
  return NAMED_PROPERTY_KEY.test(key)
}

/** Anything whose entries we can count: containers, plus Sets (counted, not entered). */
export function isCountableContainer(value: unknown): boolean {
  return value instanceof Set || isWalkableContainer(value)
}

/** True for containers safe to iterate: arrays, Maps, and plain objects. */
export function isWalkableContainer(value: unknown): value is object {
  return Array.isArray(value) || value instanceof Map || isPlainObjectShape(value)
}

/**
 * Plain data objects only. Class instances (xterm Terminals, React fibers, DOM
 * nodes, Promises, typed arrays, Zustand stores) fail the prototype test and are
 * never entered, which is what keeps huge fan-out and getter side effects out.
 */
export function isPlainObjectShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return false
  }
  const shape = value as { $$typeof?: unknown; nodeType?: unknown }
  // Why: React elements and cross-realm DOM wrappers can be prototype-plain yet
  // reach the entire tree through _owner / parentNode.
  return shape.$$typeof === undefined && typeof shape.nodeType !== 'number'
}

/**
 * Distinguishes a dictionary from a struct by whether its ENTRIES REPEAT A
 * SHAPE, because key count alone cannot: a user with three repos has a
 * three-key dictionary whose keys are repo names, and those keys would
 * otherwise be uploaded to Slack verbatim.
 *
 * A dictionary's values are interchangeable records — two or more plain objects
 * with the same field names (`{[repo]: {branches}}`). A struct's fields are not
 * (`{paneKey, state, stateHistory}` mixes scalars with an array; `{tabs, panes}`
 * holds arrays, which carry no field names to match). Erring toward "dictionary"
 * costs a field name in the label; erring the other way leaks user data.
 */
export function hasRepeatedEntryShape(container: object, isExpired?: () => boolean): boolean {
  let signature: string | null = null
  let sampled = 0
  try {
    for (const key in container) {
      // Why checked per entry: each one costs a for-in over a value that may be
      // huge, so the cap alone bounds the entry COUNT but not the time. Bailing
      // returns `true`, which collapses keys — the privacy-safe direction.
      if (sampled >= HOMOGENEITY_SAMPLE || isExpired?.() === true) {
        break
      }
      const value = (container as Record<string, unknown>)[key]
      // Why plain objects only: arrays and Maps expose no field names, so a
      // struct of arrays is indistinguishable from a dictionary of arrays.
      if (!isPlainObjectShape(value)) {
        return false
      }
      const entrySignature = fieldSignature(value as object)
      if (signature === null) {
        signature = entrySignature
      } else if (signature !== entrySignature) {
        return false
      }
      sampled += 1
    }
  } catch {
    // Why: an unreadable entry proves nothing about shape; treat keys as data.
    return true
  }
  // Why two: a single entry cannot demonstrate repetition, and a one-entry
  // container is never the leak this walker is looking for. A run cut short by
  // the deadline lands here with sampled < 2 only if it never got going, in
  // which case the strict key-syntax rule is what keeps user data out.
  return sampled >= 2
}

/**
 * True when EVERY sampled key looks like a field name, not just the one being
 * labelled.
 *
 * Why sibling-wide: a lone key is weak evidence, because user data can be
 * accidentally camelCase — a branch named `myFeature`, a repo named `orcaWeb`.
 * Siblings are what give it away: real branch and repo sets almost always
 * contain at least one `feature/x`, `fix-y`, or `snake_name`, and one such
 * sibling now condemns the whole container's keys instead of only itself.
 */
export function hasOnlyFieldNameShapedKeys(container: object): boolean {
  let sampled = 0
  try {
    for (const key in container) {
      if (sampled >= HOMOGENEITY_SAMPLE) {
        break
      }
      if (!isFieldNameShaped(key)) {
        return false
      }
      sampled += 1
    }
  } catch {
    return false
  }
  return true
}

/**
 * Field names of one entry, order-independent.
 *
 * Why for-in rather than Object.keys: both are O(entry size), but for-in reuses
 * V8's enumeration cache — which the pre-existing top-level summary has already
 * paid for on these same objects — instead of allocating a fresh key array in a
 * renderer that is at 95% of its heap. The per-entry cost is bounded by the
 * caller's deadline, not by this cap.
 */
function fieldSignature(entry: object): string {
  const fields: string[] = []
  for (const key in entry) {
    if (fields.length >= HOMOGENEITY_SAMPLE) {
      break
    }
    fields.push(key)
  }
  return fields.sort().join(',')
}
