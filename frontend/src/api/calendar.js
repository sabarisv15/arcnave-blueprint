import { api } from './client';

// Mirrors backend/src/routes/calendar.js's CALENDAR_EVENT_BODY_FIELDS
// exactly — that route reads snake_case keys off req.body.
function toEventBody({ title, eventType, startDate, endDate, description }) {
  const body = {};
  if (title !== undefined) body.title = title;
  if (eventType !== undefined) body.event_type = eventType;
  if (startDate !== undefined) body.start_date = startDate;
  if (endDate !== undefined) body.end_date = endDate;
  if (description !== undefined) body.description = description;
  return body;
}

export const calendarApi = {
  list: ({ fromDate, toDate } = {}) => {
    const params = new URLSearchParams();
    if (fromDate) params.set('from_date', fromDate);
    if (toDate) params.set('to_date', toDate);
    const qs = params.toString();
    return api.get(`/calendar-events${qs ? `?${qs}` : ''}`);
  },
  get: (id) => api.get(`/calendar-events/${id}`),
  create: (payload) => api.post('/calendar-events', toEventBody(payload)),
  update: (id, payload) => api.put(`/calendar-events/${id}`, toEventBody(payload)),
  remove: (id) => api.delete(`/calendar-events/${id}`),
};
