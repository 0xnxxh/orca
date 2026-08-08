/**
 * Runs a rollback that is already unwinding `cause` and always rethrows. A failed rollback is joined
 * to the cause rather than discarded: it leaves live admission or namespace state behind, and a caller
 * that saw only the original error would treat a partial teardown as a clean one.
 */
export async function joinTerminalAuthorityRollbackFailure(
  cause: unknown,
  rollback: () => Promise<void>
): Promise<never> {
  try {
    await rollback()
  } catch (failure) {
    throw new AggregateError(
      [cause, failure],
      'terminal authority consumer rollback failed while unwinding'
    )
  }
  throw cause
}
