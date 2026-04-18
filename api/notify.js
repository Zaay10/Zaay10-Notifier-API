// api/notify.js
import admin from 'firebase-admin';
import { Expo } from 'expo-server-sdk';

let initError = null;

// Wrap Firebase initialization in a try/catch so it doesn't hard-crash Vercel
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
      }),
    });
  }
} catch (error) {
  initError = error.message;
}

const expo = new Expo();

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST,GET');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') return res.status(200).end();

  // 🚨 IF FIREBASE FAILED, PRINT THE ERROR TO THE SCREEN
  if (initError) {
    return res.status(500).json({ 
      error: "Firebase Initialization Failed", 
      details: initError,
      hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
      hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
      hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY
    });
  }

  // 🧪 SIMPLE GET ROUTE FOR BROWSER TESTING
  if (req.method === 'GET') {
    return res.status(200).json({ status: "API is alive and Firebase is connected perfectly!" });
  }

  // ---------------------------------------------------------
  // THE ACTUAL PUSH NOTIFICATION LOGIC (POST REQUESTS ONLY)
  // ---------------------------------------------------------
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { title, body, batchId, sellerId } = req.body;

  try {
    const usersSnapshot = await admin.firestore().collection('users').get();
    const messages = [];

    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      const token = userData.expoPushToken;

      if (token && Expo.isExpoPushToken(token) && userData.id !== sellerId) {
        messages.push({
          to: token,
          sound: 'default',
          title: title,
          body: body,
          data: { linkType: 'batch', linkId: batchId },
        });
      }
    });

    if (messages.length === 0) {
      return res.status(200).json({ success: true, message: "No tokens to send" });
    }

    const chunks = expo.chunkPushNotifications(messages);
    const ticketChunkPromises = chunks.map(chunk => expo.sendPushNotificationsAsync(chunk));
    
    await Promise.all(ticketChunkPromises);

    return res.status(200).json({ success: true, sentCount: messages.length });
  } catch (error) {
    console.error('Error sending push notifications:', error);
    return res.status(500).json({ error: 'Failed to send notifications', details: error.message });
  }
}
