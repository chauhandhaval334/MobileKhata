'use strict';

const admin = require('firebase-admin');
const env = require('./env');
const logger = require('../utils/logger');

/**
 * Firebase Admin SDK initialisation.
 * Called once at server start.
 * Used by auth middleware for JWT verification.
 */
const initFirebase = () => {
  if (admin.apps.length > 0) {
    return admin; // already initialised
  }

  // In development, skip Firebase init if credentials are not configured yet
  const hasCredentials =
    env.firebase.projectId &&
    env.firebase.clientEmail &&
    env.firebase.privateKey &&
    !env.firebase.privateKey.includes('YOUR_PRIVATE_KEY');

  if (!hasCredentials) {
    if (env.NODE_ENV === 'production') {
      throw new Error('Firebase credentials are required in production. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env');
    }
    logger.warn('Firebase Admin SDK skipped — credentials not configured. Auth middleware will reject all requests. Set credentials in .env to enable.');
    return admin; // return uninitialised admin — auth middleware handles gracefully
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.firebase.projectId,
        clientEmail: env.firebase.clientEmail,
        privateKey: env.firebase.privateKey,
      }),
      storageBucket: env.firebase.storageBucket,
    });
    logger.info('Firebase Admin SDK initialised', {
      projectId: env.firebase.projectId,
    });
  } catch (err) {
    logger.error('Firebase Admin SDK init failed', { error: err.message });
    if (env.NODE_ENV === 'production') throw err;
    logger.warn('Continuing without Firebase in development mode.');
  }

  return admin;
};

module.exports = { initFirebase, admin };
