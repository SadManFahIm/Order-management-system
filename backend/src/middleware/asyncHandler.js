/**
 * Wraps an async Express handler so any rejected promise is forwarded to the
 * central error handler instead of crashing the process or hanging the request.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
