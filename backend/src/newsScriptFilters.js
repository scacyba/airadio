export function parseNewsScriptFilters(query = {}) {
  const filters = {};

  if (query.year !== undefined) {
    const year = Number(query.year);
    if (!Number.isInteger(year) || year < 1) {
      const err = new Error('year must be a positive integer');
      err.status = 400;
      err.code = 'INVALID_QUERY';
      err.details = { year: query.year };
      throw err;
    }
    filters.year = year;
  }

  if (query.month !== undefined) {
    const month = Number(query.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      const err = new Error('month must be an integer between 1 and 12');
      err.status = 400;
      err.code = 'INVALID_QUERY';
      err.details = { month: query.month };
      throw err;
    }
    filters.month = month;
  }

  if (query.category !== undefined) {
    const category = String(query.category).trim();
    if (!category) {
      const err = new Error('category must not be empty');
      err.status = 400;
      err.code = 'INVALID_QUERY';
      err.details = { category: query.category };
      throw err;
    }
    filters.category = category;
  }

  return filters;
}
