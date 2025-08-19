// Entry point for Firebase Cloud Functions
import * as functions from 'firebase-functions';

// Example HTTP function
export const helloWorld = functions.https.onRequest((request, response) => {
  response.send('Hello from MTG Training Pipeline!');
});
