/**
 * Global error handling middleware
 */
export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Validation errors
  if (err.name === 'ValidationError' || err.name === 'BadRequestError') {
    return res.status(400).json({
      success: false,
      error: err.message || 'Validation error',
    });
  }

  // Authentication errors
  if (err.name === 'UnauthorizedError' || err.message?.includes('token')) {
    return res.status(401).json({
      success: false,
      error: err.message || 'Authentication failed',
    });
  }

  // Database errors
  if (err.code === '23505') { // Unique violation
    return res.status(409).json({
      success: false,
      error: 'A record with this information already exists',
    });
  }

  if (err.code === '23503') { // Foreign key violation
    return res.status(400).json({
      success: false,
      error: 'Invalid reference to related record',
    });
  }

  // Default server error
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
  });
};

/**
 * 404 Not Found handler
 */
export const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.originalUrl} not found`,
  });
};
