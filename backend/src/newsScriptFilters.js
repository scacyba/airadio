function parsePositiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    const err = new Error(`${fieldName} must be a positive integer`);
    err.status = 400;
    err.code = 'INVALID_QUERY';
    err.details = { [fieldName]: value };
    throw err;
  }
  return parsed;
}

export function parseNewsScriptFilters(query = {}) {
  const filters = {};

  if (query.year !== undefined) {
    filters.year = parsePositiveInteger(query.year, 'year');
  }

  if (query.yearStart !== undefined) {
    filters.yearStart = parsePositiveInteger(query.yearStart, 'yearStart');
  }

  if (query.yearEnd !== undefined) {
    filters.yearEnd = parsePositiveInteger(query.yearEnd, 'yearEnd');
  }

  if (filters.yearStart !== undefined && filters.yearEnd !== undefined && filters.yearStart > filters.yearEnd) {
    const err = new Error('yearStart must be less than or equal to yearEnd');
    err.status = 400;
    err.code = 'INVALID_QUERY';
    err.details = { yearStart: query.yearStart, yearEnd: query.yearEnd };
    throw err;
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
