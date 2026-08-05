# REST API

## Cars

GET /cars
POST /cars
PUT /cars/{id}
DELETE /cars/{id}

## Events

GET /cars/{id}/events
POST /cars/{id}/events
GET /events/{id}
PUT /events/{id}
DELETE /events/{id}

## Reminders

GET /cars/{id}/reminders
POST /cars/{id}/reminders
PUT /cars/{id}/reminders/{reminderId}
DELETE /cars/{id}/reminders/{reminderId}
POST /cars/{id}/reminders/{reminderId}/complete

## Attachments

POST /attachments/presign

## AI Chat (per car; agentic)

GET  /cars/{id}/chat/sessions
POST /cars/{id}/chat/sessions
GET  /cars/{id}/chat/sessions/{sid}
PUT  /cars/{id}/chat/sessions/{sid}
DELETE /cars/{id}/chat/sessions/{sid}
POST /cars/{id}/chat/sessions/{sid}/messages
POST /cars/{id}/chat/sessions/{sid}/actions/{aid}/confirm   # perform a proposed delete
POST /cars/{id}/chat/sessions/{sid}/actions/{aid}/decline   # dismiss a proposed delete
POST /cars/{id}/chat/attachments/presign
