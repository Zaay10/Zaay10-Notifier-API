// api/notify.js
const admin = require('firebase-admin');
const { Expo } = require('expo-server-sdk');

// Initialize Firebase Admin securely using environment variables
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // The replace function ensures newline characters in the private key are parsed correctly
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
  });
}

const expo = new Expo();

module.exports = async function handler(req, res) {
  // Add CORS headers so your mobile app can hit this endpoint
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Reject anything that isn't a POST request
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

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
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
