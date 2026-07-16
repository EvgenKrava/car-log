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
