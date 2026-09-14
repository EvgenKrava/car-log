# Privacy Policy

_Last updated: 2026-09-14 — draft, under review._

## What CarLog is

CarLog is a web app for keeping the maintenance history of the vehicles you own: service events, costs, mileage, reminders, receipts, and photos, in one timeline. This page explains what we store, why, and how to remove it.

## What we store

- **Account.** Your email address and a password hash, held by Amazon Cognito. If you sign in with Google, we receive only your email address from Google.
- **Vehicle data you enter.** Cars, service events, works and parts, reminders, mileage, and the chat conversations you have with the assistant.
- **Files you upload.** Receipts, invoices, photos, and PDFs are stored in Amazon S3 in the AWS `us-east-1` (N. Virginia) region. They are private and served only through short-lived signed links.

## AI features

Invoice scans, text imports, the per-car chat, and voice dictation are processed by Amazon Bedrock and Amazon Transcribe inside AWS. Voice clips are transcribed and discarded immediately; they are never stored. Your data is not used to train any model. AI features have daily usage limits per account.

## Push notifications

Only if you turn them on. We store the browser's push subscription so we can send reminders about due services and stale mileage. Turning notifications off in your profile removes the subscription.

## Public share links

If you share a car, anyone with the link can read that car's service history until you turn sharing off. Nothing is shared by default.

## Retention

Everything is kept until you delete it. Deleting an event or a car removes its data and files. Temporary upload files (scans and import text) are purged automatically within a day.

## Deleting your account

Profile → **Delete account** removes your cars, events, files, reminders, chats, push subscriptions, and your login — immediately and permanently. There is no recovery.

## What we don't do

No analytics trackers, no advertising, no selling or sharing of your data with anyone other than the AWS services that run the app.

## Contact

Questions or requests: **evgen.cravchenco@gmail.com**.

## Changes

We will update this page and the date above when anything here changes.
